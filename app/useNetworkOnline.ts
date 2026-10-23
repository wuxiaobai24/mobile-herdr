import { useNetworkState } from 'expo-network';
export function useNetworkOnline(): boolean {
  const network = useNetworkState();
  // A LAN bridge is reachable without public Internet access (including VPNs).
  return network.isConnected !== false;
}
