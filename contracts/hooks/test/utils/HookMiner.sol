// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title HookMiner
 * @notice Utility to find valid hook addresses that encode the required permissions
 *
 * Uniswap v4 hooks encode their permissions in their contract address.
 * This utility mines a salt that produces a valid address for the given flags.
 */
library HookMiner {
    /// @notice Find a salt that produces a hook address with the required flags
    /// @param deployer The address that will deploy the hook
    /// @param flags The required hook flags encoded in the address
    /// @param creationCode The creation bytecode of the hook contract
    /// @param constructorArgs The encoded constructor arguments
    /// @return hookAddress The computed hook address
    /// @return salt The salt to use for CREATE2 deployment
    function find(
        address deployer,
        uint160 flags,
        bytes memory creationCode,
        bytes memory constructorArgs
    ) internal pure returns (address hookAddress, bytes32 salt) {
        bytes memory bytecode = abi.encodePacked(creationCode, constructorArgs);
        bytes32 bytecodeHash = keccak256(bytecode);

        uint256 saltCounter = 0;
        while (true) {
            salt = bytes32(saltCounter);
            hookAddress = computeAddress(deployer, salt, bytecodeHash);

            // Check if address has the required flags
            if (uint160(hookAddress) & flags == flags) {
                return (hookAddress, salt);
            }

            saltCounter++;

            // Safety check to prevent infinite loop in tests
            if (saltCounter > 100000) {
                revert("HookMiner: Could not find valid address");
            }
        }
    }

    /// @notice Compute CREATE2 address
    function computeAddress(
        address deployer,
        bytes32 salt,
        bytes32 bytecodeHash
    ) internal pure returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            deployer,
                            salt,
                            bytecodeHash
                        )
                    )
                )
            )
        );
    }
}