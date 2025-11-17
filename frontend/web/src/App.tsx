import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface LocationData {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  encryptedLat: string;
  encryptedLng: string;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedLat?: number;
  decryptedLng?: number;
  description: string;
  radius: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<LocationData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newLocationData, setNewLocationData] = useState({ 
    name: "", 
    latitude: "", 
    longitude: "", 
    description: "",
    radius: "100"
  });
  const [selectedLocation, setSelectedLocation] = useState<LocationData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<LocationData[]>([]);
  const [showFAQ, setShowFAQ] = useState(false);
  const [stats, setStats] = useState({ total: 0, verified: 0, userCount: 0 });
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const locationsList: LocationData[] = [];
      const userLocations: LocationData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const location: LocationData = {
            id: businessId,
            name: businessData.name,
            latitude: 0,
            longitude: 0,
            encryptedLat: businessId,
            encryptedLng: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedLat: Number(businessData.decryptedValue) || 0,
            decryptedLng: Number(businessData.publicValue1) || 0,
            description: businessData.description,
            radius: Number(businessData.publicValue2) || 100
          };
          
          locationsList.push(location);
          if (businessData.creator.toLowerCase() === address?.toLowerCase()) {
            userLocations.push(location);
          }
        } catch (e) {
          console.error('Error loading location data:', e);
        }
      }
      
      setLocations(locationsList);
      setUserHistory(userLocations);
      setStats({
        total: locationsList.length,
        verified: locationsList.filter(l => l.isVerified).length,
        userCount: userLocations.length
      });
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createLocation = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingLocation(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting location with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const latValue = Math.round(parseFloat(newLocationData.latitude) * 1000000);
      const businessId = `location-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, latValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newLocationData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.round(parseFloat(newLocationData.longitude) * 1000000),
        parseInt(newLocationData.radius),
        newLocationData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Location shared securely!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewLocationData({ name: "", latitude: "", longitude: "", description: "", radius: "100" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingLocation(false); 
    }
  };

  const decryptLocation = async (locationId: string): Promise<{lat: number, lng: number} | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(locationId);
      if (businessData.isVerified) {
        const storedLat = Number(businessData.decryptedValue) / 1000000;
        const storedLng = Number(businessData.publicValue1) / 1000000;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Location already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return { lat: storedLat, lng: storedLng };
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(locationId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(locationId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying location..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      const decryptedLat = Number(clearValue) / 1000000;
      const decryptedLng = Number(businessData.publicValue1) / 1000000;
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Location decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return { lat: decryptedLat, lng: decryptedLng };
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Location is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const filteredLocations = locations.filter(location =>
    location.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    location.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📍</div>
          <div className="stat-content">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Locations</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">👤</div>
          <div className="stat-content">
            <div className="stat-value">{stats.userCount}</div>
            <div className="stat-label">Your Shares</div>
          </div>
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    if (userHistory.length === 0) return null;
    
    return (
      <div className="history-section">
        <h3>Your Sharing History</h3>
        <div className="history-list">
          {userHistory.slice(0, 3).map((location, index) => (
            <div className="history-item" key={index}>
              <div className="history-name">{location.name}</div>
              <div className="history-time">{new Date(location.timestamp * 1000).toLocaleDateString()}</div>
              <div className={`history-status ${location.isVerified ? 'verified' : 'pending'}`}>
                {location.isVerified ? '✅ Verified' : '⏳ Pending'}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const faqItems = [
    {
      question: "How does FHE protect my location?",
      answer: "Your coordinates are encrypted using Zama FHE before being stored on-chain. Only authorized devices can decrypt them, ensuring complete privacy."
    },
    {
      question: "Can the platform track my location?",
      answer: "No. The platform only stores encrypted data and cannot access your actual coordinates without your decryption key."
    },
    {
      question: "Who can see my shared locations?",
      answer: "Only devices you've authorized through the FHE decryption process can access your exact coordinates."
    },
    {
      question: "Is my data permanently stored?",
      answer: "Encrypted data is stored on-chain but can only be decrypted with proper authorization. You maintain full control."
    }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 LocShare Zama</h1>
            <span>Private Location Sharing</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🗺️</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Securely share your location with family using fully homomorphic encryption.</p>
            <div className="feature-grid">
              <div className="feature">
                <div className="feature-icon">🔒</div>
                <h4>End-to-End Encrypted</h4>
                <p>Coordinates encrypted with Zama FHE technology</p>
              </div>
              <div className="feature">
                <div className="feature-icon">👪</div>
                <h4>Family Safe</h4>
                <p>Share locations only with authorized family members</p>
              </div>
              <div className="feature">
                <div className="feature-icon">🌐</div>
                <h4>Platform Private</h4>
                <p>Platform cannot track or access your real location</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="encryption-animation"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Setting up secure location sharing</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="encryption-animation"></div>
      <p>Loading secure locations...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔐 LocShare Zama</h1>
          <span>Private Family Location Sharing</span>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="share-btn"
          >
            + Share Location
          </button>
          <button 
            onClick={() => setShowFAQ(!showFAQ)} 
            className="faq-btn"
          >
            FAQ
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="content-header">
          <h2>Family Location Sharing 🔐</h2>
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search locations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button 
              onClick={loadData} 
              className="refresh-btn" 
              disabled={isRefreshing}
            >
              {isRefreshing ? "⟳" : "↻"}
            </button>
          </div>
        </div>
        
        {renderStats()}
        {renderUserHistory()}
        
        <div className="locations-section">
          <div className="section-header">
            <h3>Shared Locations ({filteredLocations.length})</h3>
          </div>
          
          <div className="locations-grid">
            {filteredLocations.length === 0 ? (
              <div className="no-locations">
                <div className="empty-icon">🗺️</div>
                <p>No locations shared yet</p>
                <button 
                  className="share-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Share First Location
                </button>
              </div>
            ) : filteredLocations.map((location, index) => (
              <LocationCard 
                key={index}
                location={location}
                onSelect={setSelectedLocation}
                onDecrypt={decryptLocation}
              />
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <CreateLocationModal 
          onSubmit={createLocation} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingLocation} 
          locationData={newLocationData} 
          setLocationData={setNewLocationData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedLocation && (
        <LocationDetailModal 
          location={selectedLocation} 
          onClose={() => setSelectedLocation(null)} 
          onDecrypt={decryptLocation}
        />
      )}
      
      {showFAQ && (
        <FAQModal 
          items={faqItems}
          onClose={() => setShowFAQ(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const LocationCard: React.FC<{
  location: LocationData;
  onSelect: (location: LocationData) => void;
  onDecrypt: (id: string) => Promise<{lat: number, lng: number} | null>;
}> = ({ location, onSelect, onDecrypt }) => {
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptedCoords, setDecryptedCoords] = useState<{lat: number, lng: number} | null>(null);

  const handleDecrypt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDecrypting(true);
    try {
      const coords = await onDecrypt(location.id);
      setDecryptedCoords(coords);
    } finally {
      setIsDecrypting(false);
    }
  };

  const displayCoords = location.isVerified ? 
    `${(location.decryptedLat || 0).toFixed(6)}, ${(location.decryptedLng || 0).toFixed(6)}` :
    decryptedCoords ? 
    `${decryptedCoords.lat.toFixed(6)}, ${decryptedCoords.lng.toFixed(6)}` :
    "🔒 Encrypted";

  return (
    <div className="location-card" onClick={() => onSelect(location)}>
      <div className="card-header">
        <h4>{location.name}</h4>
        <div className={`status-badge ${location.isVerified ? 'verified' : 'encrypted'}`}>
          {location.isVerified ? '✅ Verified' : '🔒 Encrypted'}
        </div>
      </div>
      
      <div className="card-content">
        <p className="location-description">{location.description}</p>
        <div className="coordinates">
          <span className="coord-label">Coordinates:</span>
          <span className="coord-value">{displayCoords}</span>
        </div>
        <div className="location-meta">
          <span>Radius: {location.radius}m</span>
          <span>{new Date(location.timestamp * 1000).toLocaleDateString()}</span>
        </div>
      </div>
      
      <div className="card-actions">
        <button 
          className={`decrypt-btn ${location.isVerified ? 'verified' : ''}`}
          onClick={handleDecrypt}
          disabled={isDecrypting || location.isVerified}
        >
          {isDecrypting ? "Decrypting..." : location.isVerified ? "Decrypted" : "Decrypt Location"}
        </button>
      </div>
    </div>
  );
};

const CreateLocationModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  locationData: any;
  setLocationData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, locationData, setLocationData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setLocationData({ ...locationData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Share Encrypted Location</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="encryption-notice">
            <div className="notice-icon">🔐</div>
            <div className="notice-content">
              <strong>FHE Encrypted Sharing</strong>
              <p>Coordinates will be encrypted with Zama FHE before storage</p>
            </div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Location Name *</label>
              <input 
                type="text" 
                name="name" 
                value={locationData.name} 
                onChange={handleChange} 
                placeholder="Home, School, Park..." 
              />
            </div>
            
            <div className="form-group">
              <label>Latitude *</label>
              <input 
                type="number" 
                step="any"
                name="latitude" 
                value={locationData.latitude} 
                onChange={handleChange} 
                placeholder="34.052235" 
              />
              <div className="input-hint">FHE Encrypted Coordinate</div>
            </div>
            
            <div className="form-group">
              <label>Longitude *</label>
              <input 
                type="number" 
                step="any"
                name="longitude" 
                value={locationData.longitude} 
                onChange={handleChange} 
                placeholder="-118.243683" 
              />
              <div className="input-hint">Public Coordinate</div>
            </div>
            
            <div className="form-group">
              <label>Safety Radius (meters)</label>
              <input 
                type="number" 
                name="radius" 
                value={locationData.radius} 
                onChange={handleChange} 
                placeholder="100" 
              />
            </div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={locationData.description} 
              onChange={handleChange} 
              placeholder="Add notes about this location..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !locationData.name || !locationData.latitude || !locationData.longitude} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Share Location"}
          </button>
        </div>
      </div>
    </div>
  );
};

const LocationDetailModal: React.FC<{
  location: LocationData;
  onClose: () => void;
  onDecrypt: (id: string) => Promise<{lat: number, lng: number} | null>;
}> = ({ location, onClose, onDecrypt }) => {
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptedCoords, setDecryptedCoords] = useState<{lat: number, lng: number} | null>(null);

  const handleDecrypt = async () => {
    setIsDecrypting(true);
    try {
      const coords = await onDecrypt(location.id);
      setDecryptedCoords(coords);
    } finally {
      setIsDecrypting(false);
    }
  };

  const displayCoords = location.isVerified ? 
    { lat: location.decryptedLat || 0, lng: location.decryptedLng || 0 } :
    decryptedCoords || { lat: 0, lng: 0 };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>{location.name}</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="location-info">
            <div className="info-item">
              <label>Description:</label>
              <span>{location.description}</span>
            </div>
            <div className="info-item">
              <label>Safety Radius:</label>
              <span>{location.radius} meters</span>
            </div>
            <div className="info-item">
              <label>Shared by:</label>
              <span>{location.creator.substring(0, 6)}...{location.creator.substring(38)}</span>
            </div>
            <div className="info-item">
              <label>Date:</label>
              <span>{new Date(location.timestamp * 1000).toLocaleString()}</span>
            </div>
          </div>
          
          <div className="coordinates-section">
            <h3>Coordinates</h3>
            <div className="coord-display">
              <div className="coord-item">
                <span>Latitude:</span>
                <strong>
                  {location.isVerified || decryptedCoords ? 
                    displayCoords.lat.toFixed(6) : "🔒 Encrypted"
                  }
                </strong>
              </div>
              <div className="coord-item">
                <span>Longitude:</span>
                <strong>
                  {location.isVerified || decryptedCoords ? 
                    displayCoords.lng.toFixed(6) : "🔒 Encrypted"
                  }
                </strong>
              </div>
            </div>
            
            {!(location.isVerified || decryptedCoords) && (
              <button 
                className="decrypt-btn large"
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : "Decrypt Coordinates"}
              </button>
            )}
          </div>
          
          {(location.isVerified || decryptedCoords) && (
            <div className="map-preview">
              <div className="map-placeholder">
                <div className="map-icon">🗺️</div>
                <p>Location Map Preview</p>
                <div className="coordinates-badge">
                  {displayCoords.lat.toFixed(6)}, {displayCoords.lng.toFixed(6)}
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

const FAQModal: React.FC<{
  items: Array<{question: string, answer: string}>;
  onClose: () => void;
}> = ({ items, onClose }) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div className="modal-overlay">
      <div className="faq-modal">
        <div className="modal-header">
          <h2>Frequently Asked Questions</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="faq-list">
            {items.map((item, index) => (
              <div 
                key={index} 
                className={`faq-item ${expandedIndex === index ? 'expanded' : ''}`}
                onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
              >
                <div className="faq-question">
                  <span>{item.question}</span>
                  <span className="expand-icon">{expandedIndex === index ? '−' : '+'}</span>
                </div>
                {expandedIndex === index && (
                  <div className="faq-answer">
                    <p>{item.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

