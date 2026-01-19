import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';

@WebSocketGateway({
    cors: {
        origin: '*',
    },
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private redisSubscriber: Redis;

    constructor() {
        const redisHost = process.env.REDIS_HOST || 'localhost';
        const redisPort = parseInt(process.env.REDIS_PORT || '6399');
        const redisPassword = process.env.REDIS_PASSWORD;

        this.redisSubscriber = new Redis({
            host: redisHost,
            port: redisPort,
            password: redisPassword,
        });
    }

    afterInit(server: Server) {
        console.log('EventsGateway initialized on main API port');

        this.redisSubscriber.subscribe('vectra_events', (err, count) => {
            if (err) {
                console.error('Failed to subscribe: %s', err.message);
            } else {
                console.log(`Subscribed to ${count} channel(s). Listening for updates on "vectra_events".`);
            }
        });

        this.redisSubscriber.on('message', (channel, message) => {
            console.log(`📥 [Redis -> Gateway] Channel: ${channel}`);
            if (channel === 'vectra_events') {
                try {
                    const eventData = JSON.parse(message);
                    console.log(`📡 [Gateway -> Clients] Broadcasting 'message_received' to all sub-sockets`);
                    // Use server.sockets.emit for the most reliable broadcast
                    this.server.sockets.emit('message_received', eventData);
                } catch (e) {
                    console.error('❌ [Gateway] JSON Parse Error:', e);
                }
            }
        });
    }

    handleConnection(client: Socket) {
        console.log(`Client connected: ${client.id}`);
        client.on('ping', () => {
            console.log(`🏓 Ping from ${client.id} - Sending direct test 'message_received'`);
            // Emit directly to this client
            client.emit('message_received', { type: 'instant_test', data: 'direct_from_ping' });
            // And broadcast to everyone
            this.server.sockets.emit('message_received', { type: 'broadcast_test', data: 'broadcast_from_ping' });
            client.emit('pong');
        });
    }

    handleDisconnect(client: Socket) {
        console.log(`Client disconnected: ${client.id}`);
    }
}
