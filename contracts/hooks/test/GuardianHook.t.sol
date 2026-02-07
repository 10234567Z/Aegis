// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {GuardianHook} from "../GuardianHook.sol";
import {HookMiner} from "./utils/HookMiner.sol";

/**
 * @title GuardianHookTest
 * @notice Tests for Guardian Protocol's Uniswap v4 Hook
 */
contract GuardianHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    GuardianHook hook;
    MockSecurityMiddleware mockMiddleware;

    PoolKey poolKey;
    PoolId poolId;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address blacklistedUser = address(0xBAD);

    function setUp() public {
        // Deploy v4 core contracts
        deployFreshManagerAndRouters();

        // Deploy mock SecurityMiddleware
        mockMiddleware = new MockSecurityMiddleware();

        // Mine a valid hook address with required flags
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.BEFORE_ADD_LIQUIDITY_FLAG
        );

        // Deploy hook to a valid address
        (address hookAddress, bytes32 salt) = HookMiner.find(
            address(this),
            flags,
            type(GuardianHook).creationCode,
            abi.encode(manager, address(mockMiddleware), address(0))
        );

        hook = new GuardianHook{salt: salt}(
            manager,
            address(mockMiddleware),
            address(0) // No guardian registry for tests
        );
        require(address(hook) == hookAddress, "Hook address mismatch");

        // Deploy test tokens
        deployMintAndApprove2Currencies();

        // Create pool with hook
        poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: hook
        });
        poolId = poolKey.toId();

        // Initialize pool
        manager.initialize(poolKey, SQRT_PRICE_1_1);

        // Add initial liquidity
        modifyLiquidityRouter.modifyLiquidity(
            poolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -60,
                tickUpper: 60,
                liquidityDelta: 1000e18,
                salt: bytes32(0)
            }),
            ""
        );
    }

    // ─── Pool Registration Tests ───

    function test_PoolRegistered() public view {
        (bool registered,,) = hook.getPoolStats(poolId);
        assertTrue(registered, "Pool should be registered");
    }

    // ─── Swap Tests ───

    function test_SwapSucceeds_WhenClean() public {
        // Swap should succeed for non-blacklisted user
        vm.prank(alice);

        swapRouter.swap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1e18,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            ""
        );

        // Verify swap was tracked
        (,, uint256 swapCount) = hook.getPoolStats(poolId);
        assertEq(swapCount, 1, "Swap count should be 1");
    }

    function test_SwapBlocked_WhenBlacklisted() public {
        // Blacklist user
        mockMiddleware.setBlacklisted(blacklistedUser, true);

        // Swap should revert for blacklisted user
        vm.prank(blacklistedUser);
        vm.expectRevert(abi.encodeWithSelector(GuardianHook.AddressBlacklisted.selector, blacklistedUser));

        swapRouter.swap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1e18,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            ""
        );
    }

    function test_SwapBlocked_WhenPaused() public {
        // Pause protocol
        mockMiddleware.setPaused(true);

        // Swap should revert when paused
        vm.prank(alice);
        vm.expectRevert(GuardianHook.ProtocolPaused.selector);

        swapRouter.swap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1e18,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            ""
        );
    }

    // ─── Large Swap Detection Tests ───

    function test_LargeSwapDetected() public {
        // Set low threshold
        hook.setLargeSwapThreshold(1e18);

        // Large swap
        vm.prank(alice);
        swapRouter.swap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -10e18, // Above threshold
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            ""
        );

        // Verify large swap was tracked
        uint256 largeSwapCount = hook.getUserLargeSwapCount(alice);
        assertEq(largeSwapCount, 1, "Large swap should be counted");
    }

    // ─── Liquidity Tests ───

    function test_AddLiquidityBlocked_WhenBlacklisted() public {
        // Blacklist user
        mockMiddleware.setBlacklisted(blacklistedUser, true);

        // Add liquidity should revert for blacklisted user
        vm.prank(blacklistedUser);
        vm.expectRevert(abi.encodeWithSelector(GuardianHook.AddressBlacklisted.selector, blacklistedUser));

        modifyLiquidityRouter.modifyLiquidity(
            poolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -60,
                tickUpper: 60,
                liquidityDelta: 100e18,
                salt: bytes32(0)
            }),
            ""
        );
    }

    // ─── View Function Tests ───

    function test_CanSwap_ReturnsCorrectStatus() public {
        // Clean user
        (bool allowed, string memory reason) = hook.canSwap(alice);
        assertTrue(allowed, "Alice should be allowed");
        assertEq(reason, "", "No reason for allowed user");

        // Blacklisted user
        mockMiddleware.setBlacklisted(blacklistedUser, true);
        (allowed, reason) = hook.canSwap(blacklistedUser);
        assertFalse(allowed, "Blacklisted user should not be allowed");
        assertEq(reason, "Address is blacklisted", "Should return blacklist reason");

        // Paused protocol
        mockMiddleware.setPaused(true);
        (allowed, reason) = hook.canSwap(alice);
        assertFalse(allowed, "Should not be allowed when paused");
        assertEq(reason, "Protocol is paused", "Should return pause reason");
    }

    // ─── Admin Tests ───

    function test_SetLargeSwapThreshold() public {
        uint256 newThreshold = 500_000e18;
        hook.setLargeSwapThreshold(newThreshold);
        assertEq(hook.largeSwapThreshold(), newThreshold);
    }

    function test_SetLargeSwapThreshold_RevertsIfNotAdmin() public {
        vm.prank(alice);
        vm.expectRevert(GuardianHook.Unauthorized.selector);
        hook.setLargeSwapThreshold(500_000e18);
    }

    function test_SetAdmin() public {
        hook.setAdmin(alice);
        assertEq(hook.admin(), alice);

        // Now alice can set threshold
        vm.prank(alice);
        hook.setLargeSwapThreshold(1e18);
        assertEq(hook.largeSwapThreshold(), 1e18);
    }
}

/**
 * @notice Mock SecurityMiddleware for testing
 */
contract MockSecurityMiddleware {
    bool public isPaused;
    mapping(address => bool) public blacklistedAddresses;

    function setPaused(bool _paused) external {
        isPaused = _paused;
    }

    function setBlacklisted(address account, bool status) external {
        blacklistedAddresses[account] = status;
    }
}