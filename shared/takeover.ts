export interface TakeoverState {
  id: string;
  phase: 'checking' | 'waiting' | 'connecting' | 'reconnecting' | 'claiming' | 'ready' | 'failed' | 'cancelled';
  message: string;
  cancellable: boolean;
  operation?: 'takeover' | 'restart';
}
