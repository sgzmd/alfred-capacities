import type { Transport, TransportRequest, TransportResponse } from './types.ts';

export type FixtureHandler =
    | TransportResponse
    | ((req: TransportRequest, callIndex: number) => TransportResponse);

export interface MockTransport extends Transport {
    calls: TransportRequest[];
    (req: TransportRequest): TransportResponse;
}

export function makeMockTransport(fixtures: Record<string, FixtureHandler> = {}): MockTransport {
    const calls: TransportRequest[] = [];

    const transport = function (req: TransportRequest): TransportResponse {
        calls.push(JSON.parse(JSON.stringify(req)));
        const key = `${req.method} ${req.path}`;
        const match = fixtures[key];
        if (!match) {
            throw new Error(`mockTransport: unhandled request "${key}"`);
        }
        if (typeof match === 'function') {
            return match(req, calls.length - 1);
        }
        return match;
    } as MockTransport;

    transport.calls = calls;
    return transport;
}
