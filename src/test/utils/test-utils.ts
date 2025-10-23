import { Server } from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import { AddressInfo } from 'net';

export class TestUtils {
  static createTestServer(): { app: express.Application; server: Server; io: SocketIOServer } {
    const app = express();
    const server = createServer(app);
    const io = new SocketIOServer(server);
    
    // Basic test configuration
    app.engine('handlebars', require('express-handlebars').engine({
      defaultLayout: false,
      extname: '.handlebars'
    }));
    app.set('view engine', 'handlebars');
    
    return { app, server, io };
  }

  static async startServer(server: Server, port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      server.listen(port, () => {
        const address = server.address() as AddressInfo;
        resolve(address.port);
      });
      server.on('error', reject);
    });
  }

  static async stopServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}