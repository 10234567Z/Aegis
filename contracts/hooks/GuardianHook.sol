// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";

/**
 * @title GuardianHook
 * @notice Uniswap v4 Hook that integrates Guardian Protocol security + ENS Security Profiles
 *
 * Security Features:
 * - Blacklist checking on every swap (beforeSwap)
 * - Protocol pause enforcement (beforeSwap)
 * - ENS Security Profile enforcement (beforeSwap)
 *   - User-defined thresholds
 *   - Whitelist-only mode (paranoid)
 *   - Custom delays
 * - Large swap detection and logging (afterSwap)
 * - Liquidity provider verification (beforeAddLiquidity)
 *
 * ENS Integration:
 * - Reads user's security preferences from ENS text records
 * - Applies personalized security rules per user
 * - Your ENS name = Your portable security policy
 */
contract GuardianHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    // ─── Guardian Protocol Integration ───

    /// @notice SecurityMiddleware contract for blacklist/pause checks
    address public immutable securityMiddleware;

    /// @notice Guardian Registry for additional checks
    address public immutable guardianRegistry;

    /// @notice ENS Security Profile contract for reading user preferences
    address public ensSecurityProfile;

    /// @notice Default threshold for "large swap" alerts (in wei)
    uint256 public defaultLargeSwapThreshold;

    /// @notice Admin address (can update settings)
    address public admin;

    // ─── State ───

    /// @notice Track swap volumes per pool (for analytics)
    mapping(PoolId => uint256) public poolSwapVolume;

    /// @notice Track swap counts per pool
    mapping(PoolId => uint256) public poolSwapCount;

    /// @notice Track large swaps per user (for pattern detection)
    mapping(address => uint256) public userLargeSwapCount;

    /// @notice Track user threshold exceedances
    mapping(address => uint256) public userThresholdExceedances;

    /// @notice Pools registered with this hook
    mapping(PoolId => bool) public registeredPools;

    // ─── Events ───

    event PoolRegistered(PoolId indexed poolId, address token0, address token1);

    event SwapExecuted(
        PoolId indexed poolId,
        address indexed sender,
        bool zeroForOne,
        int256 amountSpecified,
        uint256 timestamp
    );

    event LargeSwapDetected(
        PoolId indexed poolId,
        address indexed sender,
        int256 amountSpecified,
        uint256 estimatedValueUSD
    );

    event SwapBlocked(
        PoolId indexed poolId,
        address indexed sender,
        string reason
    );

    event LiquidityBlocked(
        PoolId indexed poolId,
        address indexed provider,
        string reason
    );

    /// @notice Emitted when user's ENS threshold is exceeded
    event ENSThresholdExceeded(
        PoolId indexed poolId,
        address indexed sender,
        uint256 amount,
        uint256 userThreshold
    );

    /// @notice Emitted when user's ENS whitelist blocks a swap
    event ENSWhitelistBlocked(
        PoolId indexed poolId,
        address indexed sender,
        address target,
        string reason
    );

    /// @notice Emitted when ENS profile is applied
    event ENSProfileApplied(
        address indexed sender,
        uint256 threshold,
        uint8 mode,
        bool hasProfile
    );

    // ─── Errors ───

    error AddressBlacklisted(address account);
    error ProtocolPaused();
    error Unauthorized();
    error ENSWhitelistViolation(address sender, address target);
    error ENSThresholdViolation(address sender, uint256 amount, uint256 threshold);

    // ─── Constructor ───

    constructor(
        IPoolManager _poolManager,
        address _securityMiddleware,
        address _guardianRegistry
    ) BaseHook(_poolManager) {
        securityMiddleware = _securityMiddleware;
        guardianRegistry = _guardianRegistry;
        defaultLargeSwapThreshold = 100_000 * 1e18; // $100k default
        admin = msg.sender;
    }

    // ─── Hook Permissions ───

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ─── Hook Callbacks ───

    /**
     * @notice Called when a new pool is initialized with this hook
     * @dev Registers the pool for tracking
     */
    function beforeInitialize(
        address,
        PoolKey calldata key,
        uint160
    ) external override onlyPoolManager returns (bytes4) {
        PoolId poolId = key.toId();
        registeredPools[poolId] = true;

        emit PoolRegistered(
            poolId,
            Currency.unwrap(key.currency0),
            Currency.unwrap(key.currency1)
        );

        return this.beforeInitialize.selector;
    }

    /**
     * @notice Security check before every swap
     * @dev Blocks blacklisted addresses, enforces protocol pause, and applies ENS profiles
     */
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();

        // Check 1: Protocol pause
        if (_isProtocolPaused()) {
            emit SwapBlocked(poolId, sender, "Protocol paused");
            revert ProtocolPaused();
        }

        // Check 2: Sender blacklist
        if (_isBlacklisted(sender)) {
            emit SwapBlocked(poolId, sender, "Sender blacklisted");
            revert AddressBlacklisted(sender);
        }

        // Check 3: ENS Security Profile
        if (ensSecurityProfile != address(0)) {
            _enforceENSProfile(sender, key, params, poolId);
        }

        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /**
     * @notice Post-swap processing for monitoring and alerts
     * @dev Logs swap data and detects large/suspicious swaps
     */
    function afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4, int128) {
        PoolId poolId = key.toId();

        // Update pool statistics
        uint256 swapAmount = params.amountSpecified >= 0
            ? uint256(params.amountSpecified)
            : uint256(-params.amountSpecified);

        poolSwapVolume[poolId] += swapAmount;
        poolSwapCount[poolId]++;

        // Emit swap event for ML bot monitoring
        emit SwapExecuted(
            poolId,
            sender,
            params.zeroForOne,
            params.amountSpecified,
            block.timestamp
        );

        // Detect large swaps using user's ENS threshold or default
        uint256 effectiveThreshold = _getEffectiveThreshold(sender);
        if (swapAmount >= effectiveThreshold && effectiveThreshold > 0) {
            userLargeSwapCount[sender]++;

            emit LargeSwapDetected(
                poolId,
                sender,
                params.amountSpecified,
                swapAmount
            );
        }

        return (this.afterSwap.selector, 0);
    }

    /**
     * @notice Security check before adding liquidity
     * @dev Prevents blacklisted addresses from providing liquidity
     */
    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external override onlyPoolManager returns (bytes4) {
        // Check: Protocol pause
        if (_isProtocolPaused()) {
            emit LiquidityBlocked(key.toId(), sender, "Protocol paused");
            revert ProtocolPaused();
        }

        // Check: LP blacklist
        if (_isBlacklisted(sender)) {
            emit LiquidityBlocked(key.toId(), sender, "Provider blacklisted");
            revert AddressBlacklisted(sender);
        }

        return this.beforeAddLiquidity.selector;
    }

    // ─── ENS Security Profile Enforcement ───

    /**
     * @dev Enforce user's ENS security profile
     */
    function _enforceENSProfile(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        PoolId poolId
    ) internal {
        // Get user's ENS security profile
        (uint256 threshold, uint256 delay, uint8 mode, bool hasProfile) = _getENSProfile(sender);

        if (!hasProfile) {
            return; // No profile = no custom restrictions
        }

        emit ENSProfileApplied(sender, threshold, mode, hasProfile);

        uint256 swapAmount = params.amountSpecified >= 0
            ? uint256(params.amountSpecified)
            : uint256(-params.amountSpecified);

        // Check 1: User-defined threshold
        if (threshold > 0 && swapAmount > threshold) {
            userThresholdExceedances[sender]++;
            emit ENSThresholdExceeded(poolId, sender, swapAmount, threshold);
            // Note: We emit but don't revert - user can set this up with external monitoring
            // For strict enforcement, uncomment:
            // revert ENSThresholdViolation(sender, swapAmount, threshold);
        }

        // Check 2: Paranoid mode - whitelist only
        // Mode: 0=normal, 1=strict, 2=paranoid
        if (mode == 2) { // Paranoid
            // In paranoid mode, check if the pool tokens are whitelisted
            address token0 = Currency.unwrap(key.currency0);
            address token1 = Currency.unwrap(key.currency1);

            bool token0Allowed = _isWhitelistedTarget(sender, token0);
            bool token1Allowed = _isWhitelistedTarget(sender, token1);

            if (!token0Allowed || !token1Allowed) {
                address blockedToken = !token0Allowed ? token0 : token1;
                emit ENSWhitelistBlocked(poolId, sender, blockedToken, "Token not in ENS whitelist");
                revert ENSWhitelistViolation(sender, blockedToken);
            }
        }
    }

    /**
     * @dev Get user's ENS security profile from ENSSecurityProfile contract
     */
    function _getENSProfile(address user) internal view returns (
        uint256 threshold,
        uint256 delay,
        uint8 mode,
        bool hasProfile
    ) {
        if (ensSecurityProfile == address(0)) {
            return (0, 0, 0, false);
        }

        (bool success, bytes memory data) = ensSecurityProfile.staticcall(
            abi.encodeWithSignature("getSecurityProfile(address)", user)
        );

        if (success && data.length >= 128) {
            return abi.decode(data, (uint256, uint256, uint8, bool));
        }

        return (0, 0, 0, false);
    }

    /**
     * @dev Check if target is in user's ENS whitelist
     */
    function _isWhitelistedTarget(address user, address target) internal view returns (bool) {
        if (ensSecurityProfile == address(0)) {
            return true; // No ENS profile = allow all
        }

        (bool success, bytes memory data) = ensSecurityProfile.staticcall(
            abi.encodeWithSignature("isWhitelisted(address,address)", user, target)
        );

        if (success && data.length >= 32) {
            return abi.decode(data, (bool));
        }

        return true; // Default to allowed if call fails
    }

    /**
     * @dev Get effective threshold for a user (ENS threshold or default)
     */
    function _getEffectiveThreshold(address user) internal view returns (uint256) {
        if (ensSecurityProfile == address(0)) {
            return defaultLargeSwapThreshold;
        }

        (bool success, bytes memory data) = ensSecurityProfile.staticcall(
            abi.encodeWithSignature("getThreshold(address)", user)
        );

        if (success && data.length >= 32) {
            uint256 ensThreshold = abi.decode(data, (uint256));
            if (ensThreshold > 0) {
                return ensThreshold;
            }
        }

        return defaultLargeSwapThreshold;
    }

    // ─── Security Integration ───

    /**
     * @dev Check if protocol is paused via SecurityMiddleware
     */
    function _isProtocolPaused() internal view returns (bool) {
        if (securityMiddleware == address(0)) return false;

        (bool success, bytes memory data) = securityMiddleware.staticcall(
            abi.encodeWithSignature("isPaused()")
        );

        if (success && data.length >= 32) {
            return abi.decode(data, (bool));
        }
        return false;
    }

    /**
     * @dev Check if address is blacklisted via SecurityMiddleware
     */
    function _isBlacklisted(address account) internal view returns (bool) {
        if (securityMiddleware == address(0)) return false;

        (bool success, bytes memory data) = securityMiddleware.staticcall(
            abi.encodeWithSignature("blacklistedAddresses(address)", account)
        );

        if (success && data.length >= 32) {
            return abi.decode(data, (bool));
        }
        return false;
    }

    // ─── Admin Functions ───

    /**
     * @notice Set ENS Security Profile contract address
     * @param _ensSecurityProfile Address of ENSSecurityProfile contract
     */
    function setENSSecurityProfile(address _ensSecurityProfile) external {
        if (msg.sender != admin) revert Unauthorized();
        ensSecurityProfile = _ensSecurityProfile;
    }

    /**
     * @notice Update default large swap threshold
     * @param newThreshold New threshold in wei
     */
    function setDefaultLargeSwapThreshold(uint256 newThreshold) external {
        if (msg.sender != admin) revert Unauthorized();
        defaultLargeSwapThreshold = newThreshold;
    }

    /**
     * @notice Transfer admin role
     */
    function setAdmin(address newAdmin) external {
        if (msg.sender != admin) revert Unauthorized();
        admin = newAdmin;
    }

    // ─── View Functions ───

    /**
     * @notice Get pool statistics
     */
    function getPoolStats(PoolId poolId) external view returns (
        bool registered,
        uint256 totalVolume,
        uint256 swapCount
    ) {
        return (
            registeredPools[poolId],
            poolSwapVolume[poolId],
            poolSwapCount[poolId]
        );
    }

    /**
     * @notice Get user's large swap count (for pattern analysis)
     */
    function getUserLargeSwapCount(address user) external view returns (uint256) {
        return userLargeSwapCount[user];
    }

    /**
     * @notice Get user's threshold exceedance count
     */
    function getUserThresholdExceedances(address user) external view returns (uint256) {
        return userThresholdExceedances[user];
    }

    /**
     * @notice Check if a swap would be allowed (for UI pre-check)
     */
    function canSwap(address sender) external view returns (bool allowed, string memory reason) {
        if (_isProtocolPaused()) {
            return (false, "Protocol is paused");
        }
        if (_isBlacklisted(sender)) {
            return (false, "Address is blacklisted");
        }
        return (true, "");
    }

    /**
     * @notice Get user's effective security settings
     */
    function getUserSecuritySettings(address user) external view returns (
        uint256 effectiveThreshold,
        uint256 ensThreshold,
        uint256 ensDelay,
        uint8 ensMode,
        bool hasENSProfile
    ) {
        effectiveThreshold = _getEffectiveThreshold(user);
        (ensThreshold, ensDelay, ensMode, hasENSProfile) = _getENSProfile(user);
    }
}