// src/transport/types.ts — transport contracts. Strictly synchronous.

export interface TransportRequest {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | null | undefined>;
}

export interface TransportResponse {
    status: number;
    text: string;
}

export type Transport = (req: TransportRequest) => TransportResponse;
