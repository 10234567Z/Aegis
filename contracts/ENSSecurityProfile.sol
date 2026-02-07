// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ENSSecurityProfile
 * @notice On-chain reader for ENS-based security profiles
 *
 * Users store their DeFi security preferences in ENS text records.
 * This contract reads those preferences for on-chain enforcement.
 *
 * Text Record Keys:
 *   - defi.guardian.threshold   : Wei amount to flag transactions above
 *   - defi.guardian.delay       : Extra delay in seconds
 *   - defi.guardian.whitelist   : Comma-separated allowed addresses/names
 *   - defi.guardian.mode        : strict | normal | paranoid
 *
 * Integration:
 *   GuardianHook calls this contract to get user preferences
 *   before allowing swaps/liquidity operations.
 */

// ─── ENS Interfaces ───

interface IENS {
    function resolver(bytes32 node) external view returns (address);
    function owner(bytes32 node) external view returns (address);
}

interface IENSResolver {
    function text(bytes32 node, string calldata key) external view returns (string memory);
    function addr(bytes32 node) external view returns (address);
    function name(bytes32 node) external view returns (string memory);
}

// ─── Main Contract ───

contract ENSSecurityProfile {
    // ─── Constants ───

    /// @notice ENS Registry address (same on mainnet & most testnets)
    IENS public immutable ens;

    /// @notice Text record key prefix
    string public constant KEY_PREFIX = "defi.guardian.";

    /// @notice Individual keys
    string public constant KEY_THRESHOLD = "defi.guardian.threshold";
    string public constant KEY_DELAY = "defi.guardian.delay";
    string public constant KEY_WHITELIST = "defi.guardian.whitelist";
    string public constant KEY_MODE = "defi.guardian.mode";

    /// @notice Security modes
    uint8 public constant MODE_NORMAL = 0;
    uint8 public constant MODE_STRICT = 1;
    uint8 public constant MODE_PARANOID = 2;

    // ─── Events ───

    event ProfileRead(
        address indexed user,
        bytes32 indexed node,
        uint256 threshold,
        uint256 delay,
        uint8 mode
    );

    // ─── Errors ───

    error NoENSName(address user);
    error NoResolver(bytes32 node);

    // ─── Constructor ───

    constructor(address _ensRegistry) {
        ens = IENS(_ensRegistry);
    }

    // ─── Main Read Functions ───

    /**
     * @notice Get complete security profile for a user
     * @param user The user's address
     * @return threshold Amount in wei to flag transactions above
     * @return delay Extra delay in seconds for flagged transactions
     * @return mode Security mode (0=normal, 1=strict, 2=paranoid)
     * @return hasProfile Whether user has any profile set
     */
    function getSecurityProfile(address user) external view returns (
        uint256 threshold,
        uint256 delay,
        uint8 mode,
        bool hasProfile
    ) {
        // Get user's ENS node via reverse resolution
        bytes32 node = _getReverseNode(user);
        address resolver = ens.resolver(node);

        if (resolver == address(0)) {
            // No reverse record - return defaults
            return (0, 0, MODE_NORMAL, false);
        }

        // Get the forward name
        string memory name = IENSResolver(resolver).name(node);
        if (bytes(name).length == 0) {
            return (0, 0, MODE_NORMAL, false);
        }

        // Get forward node and resolver
        bytes32 forwardNode = _namehash(name);
        address forwardResolver = ens.resolver(forwardNode);

        if (forwardResolver == address(0)) {
            return (0, 0, MODE_NORMAL, false);
        }

        // Read text records
        IENSResolver res = IENSResolver(forwardResolver);

        string memory thresholdStr = res.text(forwardNode, KEY_THRESHOLD);
        string memory delayStr = res.text(forwardNode, KEY_DELAY);
        string memory modeStr = res.text(forwardNode, KEY_MODE);

        // Parse values
        threshold = _parseUint(thresholdStr);
        delay = _parseUint(delayStr);
        mode = _parseMode(modeStr);
        hasProfile = bytes(thresholdStr).length > 0 ||
                     bytes(delayStr).length > 0 ||
                     bytes(modeStr).length > 0;

        return (threshold, delay, mode, hasProfile);
    }

    /**
     * @notice Get just the threshold for a user
     * @param user The user's address
     * @return threshold Amount in wei (0 if not set)
     */
    function getThreshold(address user) external view returns (uint256 threshold) {
        (threshold,,,) = this.getSecurityProfile(user);
    }

    /**
     * @notice Get just the delay for a user
     * @param user The user's address
     * @return delay Extra delay in seconds (0 if not set)
     */
    function getDelay(address user) external view returns (uint256 delay) {
        (, delay,,) = this.getSecurityProfile(user);
    }

    /**
     * @notice Get just the mode for a user
     * @param user The user's address
     * @return mode Security mode (0=normal, 1=strict, 2=paranoid)
     */
    function getMode(address user) external view returns (uint8 mode) {
        (,, mode,) = this.getSecurityProfile(user);
    }

    /**
     * @notice Check if user has any security profile set
     * @param user The user's address
     * @return hasProfile True if any setting is configured
     */
    function hasProfile(address user) external view returns (bool) {
        (,,, bool _hasProfile) = this.getSecurityProfile(user);
        return _hasProfile;
    }

    /**
     * @notice Check if a target is in user's whitelist
     * @param user The user's address
     * @param target The target address to check
     * @return allowed True if target is whitelisted (or no whitelist set)
     */
    function isWhitelisted(address user, address target) external view returns (bool allowed) {
        // Get user's ENS name
        bytes32 node = _getReverseNode(user);
        address resolver = ens.resolver(node);

        if (resolver == address(0)) {
            return true; // No ENS = allow all
        }

        string memory name = IENSResolver(resolver).name(node);
        if (bytes(name).length == 0) {
            return true; // No name = allow all
        }

        // Get whitelist
        bytes32 forwardNode = _namehash(name);
        address forwardResolver = ens.resolver(forwardNode);

        if (forwardResolver == address(0)) {
            return true;
        }

        string memory whitelist = IENSResolver(forwardResolver).text(forwardNode, KEY_WHITELIST);

        if (bytes(whitelist).length == 0) {
            return true; // Empty whitelist = allow all
        }

        // Check if target address is in whitelist
        // Whitelist format: "0x123...,0x456...,uniswap.eth"
        return _isAddressInList(whitelist, target);
    }

    /**
     * @notice Check if amount exceeds user's threshold
     * @param user The user's address
     * @param amount The transaction amount in wei
     * @return exceeds True if amount > threshold (false if no threshold set)
     */
    function exceedsThreshold(address user, uint256 amount) external view returns (bool exceeds) {
        uint256 threshold = this.getThreshold(user);
        if (threshold == 0) {
            return false; // No threshold = never exceeds
        }
        return amount > threshold;
    }

    /**
     * @notice Check if user is in paranoid mode (whitelist-only)
     * @param user The user's address
     * @return paranoid True if mode is paranoid
     */
    function isParanoidMode(address user) external view returns (bool paranoid) {
        uint8 mode = this.getMode(user);
        return mode == MODE_PARANOID;
    }

    // ─── Direct ENS Name Lookup ───

    /**
     * @notice Get security profile by ENS name directly
     * @param name The ENS name (e.g., "alice.eth")
     * @return threshold Amount in wei
     * @return delay Extra delay in seconds
     * @return mode Security mode
     * @return hasProfile Whether profile is set
     */
    function getProfileByName(string calldata name) external view returns (
        uint256 threshold,
        uint256 delay,
        uint8 mode,
        bool hasProfile
    ) {
        bytes32 node = _namehash(name);
        address resolver = ens.resolver(node);

        if (resolver == address(0)) {
            return (0, 0, MODE_NORMAL, false);
        }

        IENSResolver res = IENSResolver(resolver);

        string memory thresholdStr = res.text(node, KEY_THRESHOLD);
        string memory delayStr = res.text(node, KEY_DELAY);
        string memory modeStr = res.text(node, KEY_MODE);

        threshold = _parseUint(thresholdStr);
        delay = _parseUint(delayStr);
        mode = _parseMode(modeStr);
        hasProfile = bytes(thresholdStr).length > 0 ||
                     bytes(delayStr).length > 0 ||
                     bytes(modeStr).length > 0;

        return (threshold, delay, mode, hasProfile);
    }

    /**
     * @notice Get raw text record for a user
     * @param user The user's address
     * @param key The text record key
     * @return value The text record value
     */
    function getTextRecord(address user, string calldata key) external view returns (string memory value) {
        bytes32 node = _getReverseNode(user);
        address resolver = ens.resolver(node);

        if (resolver == address(0)) {
            return "";
        }

        string memory name = IENSResolver(resolver).name(node);
        if (bytes(name).length == 0) {
            return "";
        }

        bytes32 forwardNode = _namehash(name);
        address forwardResolver = ens.resolver(forwardNode);

        if (forwardResolver == address(0)) {
            return "";
        }

        return IENSResolver(forwardResolver).text(forwardNode, key);
    }

    // ─── Internal Helpers ───

    /**
     * @dev Get reverse resolution node for an address
     */
    function _getReverseNode(address addr) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            keccak256(abi.encodePacked(bytes32(0), keccak256("reverse"))),
            keccak256(abi.encodePacked(bytes32(0), keccak256("addr"))),
            keccak256(_addressToString(addr))
        ));
    }

    /**
     * @dev Compute namehash for an ENS name
     */
    function _namehash(string memory name) internal pure returns (bytes32 node) {
        node = bytes32(0);
        if (bytes(name).length == 0) {
            return node;
        }

        // Split by dots and hash from right to left
        bytes memory nameBytes = bytes(name);
        uint256 lastDot = nameBytes.length;

        for (uint256 i = nameBytes.length; i > 0; i--) {
            if (nameBytes[i - 1] == '.') {
                node = keccak256(abi.encodePacked(node, _labelhash(name, i, lastDot)));
                lastDot = i - 1;
            }
        }

        node = keccak256(abi.encodePacked(node, _labelhash(name, 0, lastDot)));
        return node;
    }

    /**
     * @dev Get keccak256 hash of a label within a name
     */
    function _labelhash(string memory name, uint256 start, uint256 end) internal pure returns (bytes32) {
        bytes memory nameBytes = bytes(name);
        bytes memory label = new bytes(end - start);
        for (uint256 i = start; i < end; i++) {
            label[i - start] = nameBytes[i];
        }
        return keccak256(label);
    }

    /**
     * @dev Convert address to lowercase hex string (without 0x prefix)
     */
    function _addressToString(address addr) internal pure returns (bytes memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory result = new bytes(40);
        uint160 value = uint160(addr);

        for (uint256 i = 40; i > 0; i--) {
            result[i - 1] = alphabet[value & 0xf];
            value >>= 4;
        }

        return result;
    }

    /**
     * @dev Parse uint from string
     */
    function _parseUint(string memory s) internal pure returns (uint256 result) {
        bytes memory b = bytes(s);
        if (b.length == 0) {
            return 0;
        }

        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c >= 48 && c <= 57) {
                result = result * 10 + (c - 48);
            } else {
                break; // Stop at first non-digit
            }
        }

        return result;
    }

    /**
     * @dev Parse security mode from string
     */
    function _parseMode(string memory s) internal pure returns (uint8) {
        bytes memory b = bytes(s);
        if (b.length == 0) {
            return MODE_NORMAL;
        }

        // Check first char for quick matching
        if (b[0] == 'p' || b[0] == 'P') {
            return MODE_PARANOID;
        }
        if (b[0] == 's' || b[0] == 'S') {
            return MODE_STRICT;
        }

        return MODE_NORMAL;
    }

    /**
     * @dev Check if address is in comma-separated list
     */
    function _isAddressInList(string memory list, address target) internal view returns (bool) {
        bytes memory listBytes = bytes(list);
        bytes memory targetHex = _addressToHexString(target);

        // Simple substring search for the address
        // This is O(n*m) but whitelist should be small
        uint256 targetLen = targetHex.length;
        if (listBytes.length < targetLen) {
            return false;
        }

        for (uint256 i = 0; i <= listBytes.length - targetLen; i++) {
            bool match = true;
            for (uint256 j = 0; j < targetLen && match; j++) {
                // Case-insensitive comparison
                bytes1 a = listBytes[i + j];
                bytes1 b = targetHex[j];

                // Convert to lowercase
                if (a >= 'A' && a <= 'Z') a = bytes1(uint8(a) + 32);
                if (b >= 'A' && b <= 'Z') b = bytes1(uint8(b) + 32);

                if (a != b) {
                    match = false;
                }
            }
            if (match) {
                return true;
            }
        }

        // Also try resolving ENS names in the list
        // (More expensive - only do if direct match fails)
        return _checkENSNamesInList(list, target);
    }

    /**
     * @dev Convert address to hex string with 0x prefix
     */
    function _addressToHexString(address addr) internal pure returns (bytes memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory result = new bytes(42);
        result[0] = '0';
        result[1] = 'x';
        uint160 value = uint160(addr);

        for (uint256 i = 41; i > 1; i--) {
            result[i] = alphabet[value & 0xf];
            value >>= 4;
        }

        return result;
    }

    /**
     * @dev Check if target matches any ENS names in the whitelist
     */
    function _checkENSNamesInList(string memory list, address target) internal view returns (bool) {
        // Parse comma-separated entries and resolve ENS names
        bytes memory listBytes = bytes(list);
        uint256 start = 0;

        for (uint256 i = 0; i <= listBytes.length; i++) {
            if (i == listBytes.length || listBytes[i] == ',') {
                if (i > start) {
                    // Extract entry
                    bytes memory entry = new bytes(i - start);
                    for (uint256 j = start; j < i; j++) {
                        entry[j - start] = listBytes[j];
                    }

                    // Trim whitespace
                    string memory trimmed = _trim(string(entry));

                    // Check if it's an ENS name (ends with .eth)
                    if (_endsWithEth(trimmed)) {
                        bytes32 node = _namehash(trimmed);
                        address resolver = ens.resolver(node);
                        if (resolver != address(0)) {
                            address resolved = IENSResolver(resolver).addr(node);
                            if (resolved == target) {
                                return true;
                            }
                        }
                    }
                }
                start = i + 1;
            }
        }

        return false;
    }

    /**
     * @dev Trim whitespace from string
     */
    function _trim(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        uint256 start = 0;
        uint256 end = b.length;

        while (start < end && (b[start] == ' ' || b[start] == '\t')) {
            start++;
        }
        while (end > start && (b[end - 1] == ' ' || b[end - 1] == '\t')) {
            end--;
        }

        bytes memory trimmed = new bytes(end - start);
        for (uint256 i = start; i < end; i++) {
            trimmed[i - start] = b[i];
        }

        return string(trimmed);
    }

    /**
     * @dev Check if string ends with ".eth"
     */
    function _endsWithEth(string memory s) internal pure returns (bool) {
        bytes memory b = bytes(s);
        if (b.length < 4) return false;

        return b[b.length - 4] == '.' &&
               (b[b.length - 3] == 'e' || b[b.length - 3] == 'E') &&
               (b[b.length - 2] == 't' || b[b.length - 2] == 'T') &&
               (b[b.length - 1] == 'h' || b[b.length - 1] == 'H');
    }
}