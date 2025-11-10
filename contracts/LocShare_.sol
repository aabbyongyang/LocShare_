pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LocShare_Zama is ZamaEthereumConfig {
    struct LocationData {
        string deviceId;
        euint32 encryptedLatitude;
        euint32 encryptedLongitude;
        uint256 timestamp;
        address owner;
        bool isShared;
        uint32 decryptedLatitude;
        uint32 decryptedLongitude;
    }

    mapping(string => LocationData) public locationData;
    mapping(address => string[]) public userLocations;
    
    event LocationCreated(string indexed deviceId, address indexed owner);
    event LocationShared(string indexed deviceId, address indexed recipient);
    event LocationDecrypted(string indexed deviceId, uint32 latitude, uint32 longitude);

    constructor() ZamaEthereumConfig() {
    }

    function createLocation(
        string calldata deviceId,
        externalEuint32 encryptedLatitude,
        bytes calldata latitudeProof,
        externalEuint32 encryptedLongitude,
        bytes calldata longitudeProof
    ) external {
        require(bytes(locationData[deviceId].deviceId).length == 0, "Device ID already exists");

        euint32 lat = FHE.fromExternal(encryptedLatitude, latitudeProof);
        euint32 lon = FHE.fromExternal(encryptedLongitude, longitudeProof);

        require(FHE.isInitialized(lat), "Invalid encrypted latitude");
        require(FHE.isInitialized(lon), "Invalid encrypted longitude");

        locationData[deviceId] = LocationData({
            deviceId: deviceId,
            encryptedLatitude: lat,
            encryptedLongitude: lon,
            timestamp: block.timestamp,
            owner: msg.sender,
            isShared: false,
            decryptedLatitude: 0,
            decryptedLongitude: 0
        });

        FHE.allowThis(locationData[deviceId].encryptedLatitude);
        FHE.allowThis(locationData[deviceId].encryptedLongitude);

        userLocations[msg.sender].push(deviceId);
        emit LocationCreated(deviceId, msg.sender);
    }

    function shareLocation(string calldata deviceId, address recipient) external {
        require(bytes(locationData[deviceId].deviceId).length > 0, "Location does not exist");
        require(locationData[deviceId].owner == msg.sender, "Only owner can share");
        require(!locationData[deviceId].isShared, "Location already shared");

        FHE.makePubliclyDecryptable(locationData[deviceId].encryptedLatitude);
        FHE.makePubliclyDecryptable(locationData[deviceId].encryptedLongitude);

        locationData[deviceId].isShared = true;
        userLocations[recipient].push(deviceId);
        emit LocationShared(deviceId, recipient);
    }

    function decryptLocation(
        string calldata deviceId,
        bytes memory latitudeProof,
        bytes memory longitudeProof
    ) external {
        require(bytes(locationData[deviceId].deviceId).length > 0, "Location does not exist");
        require(locationData[deviceId].isShared, "Location not shared");

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(locationData[deviceId].encryptedLatitude);
        cts[1] = FHE.toBytes32(locationData[deviceId].encryptedLongitude);

        bytes memory latBytes = FHE.decrypt(cts[0], latitudeProof);
        bytes memory lonBytes = FHE.decrypt(cts[1], longitudeProof);

        uint32 latitude = abi.decode(latBytes, (uint32));
        uint32 longitude = abi.decode(lonBytes, (uint32));

        locationData[deviceId].decryptedLatitude = latitude;
        locationData[deviceId].decryptedLongitude = longitude;

        emit LocationDecrypted(deviceId, latitude, longitude);
    }

    function getEncryptedCoordinates(string calldata deviceId) external view returns (euint32, euint32) {
        require(bytes(locationData[deviceId].deviceId).length > 0, "Location does not exist");
        return (locationData[deviceId].encryptedLatitude, locationData[deviceId].encryptedLongitude);
    }

    function getLocationData(string calldata deviceId) external view returns (
        string memory deviceId_,
        uint256 timestamp,
        address owner,
        bool isShared,
        uint32 decryptedLatitude,
        uint32 decryptedLongitude
    ) {
        require(bytes(locationData[deviceId].deviceId).length > 0, "Location does not exist");
        LocationData storage data = locationData[deviceId];

        return (
            data.deviceId,
            data.timestamp,
            data.owner,
            data.isShared,
            data.decryptedLatitude,
            data.decryptedLongitude
        );
    }

    function getUserLocations(address user) external view returns (string[] memory) {
        return userLocations[user];
    }

    function verifyLocationAccess(string calldata deviceId, address user) external view returns (bool) {
        if (locationData[deviceId].owner == user) return true;
        if (locationData[deviceId].isShared) {
            for (uint i = 0; i < userLocations[user].length; i++) {
                if (keccak256(bytes(userLocations[user][i])) == keccak256(bytes(deviceId))) {
                    return true;
                }
            }
        }
        return false;
    }
}

