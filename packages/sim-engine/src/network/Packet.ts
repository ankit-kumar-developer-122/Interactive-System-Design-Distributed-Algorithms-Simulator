/**
 * Packet representation in the simulation network.
 */
export interface Packet {
  /** Unique packet identifier */
  id: string;
  /** Sender node ID */
  from: number;
  /** Receiver node ID */
  to: number;
  /** Packet payload data */
  data: Record<string, unknown>;
  /** Timestamp when packet was created */
  createdAt: number;
  /** Estimated arrival time at destination */
  estimatedArrival: number;
  /** Whether this packet has been delivered */
  delivered: boolean;
  /** Whether this packet was dropped */
  dropped: boolean;
}

/** Factory function to create a new Packet instance */
export function createPacket(
  id: string,
  from: number,
  to: number,
  data: Record<string, unknown>,
  createdAt: number
): Packet {
  return {
    id,
    from,
    to,
    data,
    createdAt,
    estimatedArrival: 0, // Set by NetworkLink.send()
    delivered: false,
    dropped: false,
  };
}
