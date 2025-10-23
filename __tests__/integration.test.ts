import request from "supertest";
import { io as ioc } from "socket.io-client";
import { TestUtils } from "./utils/test-utils";
import { Server } from "http";
import { GameServer } from "../src/game/gameServer";
import { Application } from "express";

describe("Full Integration Test", () => {
	let app: Application;
	let server: Server;
	let io: any;
	let gameServer: GameServer;
	let port: number;

	beforeAll(async () => {
		const testSetup = TestUtils.createTestServer();
		app = testSetup.app;
		server = testSetup.server;
		io = testSetup.io;

		// Setup your actual routes
		app.get("/", (req, res) => {
			res.render("index");
		});

		port = await TestUtils.startServer(server);
		gameServer = new GameServer(io);
	});

	afterAll(async () => {
		await TestUtils.stopServer(server);
	});

	it("should handle HTTP and WebSocket connections together", async () => {
		// Test HTTP
		const httpResponse = await request(app).get("/");
		expect(httpResponse.status).toBe(200);

		// Test WebSocket
		const clientSocket = ioc(`http://localhost:${port}`);

		await new Promise<void>((resolve) => {
			clientSocket.on("connect", () => {
				expect(clientSocket.connected).toBe(true);
				clientSocket.disconnect();
				resolve();
			});
		});
	});
});
