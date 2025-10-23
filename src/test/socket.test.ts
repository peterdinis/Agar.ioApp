import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { Server } from "http";
import { TestUtils } from "./utils/test-utils";
import { GameServer } from "../game/gameServer";

describe("Socket.io Connections", () => {
	let server: Server;
	let io: any;
	let gameServer: GameServer;
	let clientSocket: ClientSocket;
	let port: number;

	beforeAll(async () => {
		const testSetup = TestUtils.createTestServer();
		server = testSetup.server;
		io = testSetup.io;

		port = await TestUtils.startServer(server);
	});

	beforeEach(() => {
		// Create new game server for each test
		gameServer = new GameServer(io);

		// Create client connection
		clientSocket = ioc(`http://localhost:${port}`);
	});

	afterEach(() => {
		if (clientSocket.connected) {
			clientSocket.disconnect();
		}
	});

	afterAll(async () => {
		await TestUtils.stopServer(server);
	});

	describe("Connection handling", () => {
		it("should handle client connection", (done) => {
			clientSocket.on("connect", () => {
				expect(clientSocket.connected).toBe(true);
				done();
			});
		});

		it("should handle client disconnection", (done) => {
			clientSocket.on("connect", () => {
				expect(clientSocket.connected).toBe(true);

				clientSocket.disconnect();

				setTimeout(() => {
					expect(clientSocket.connected).toBe(false);
					done();
				}, 100);
			});
		});
	});

	// Add more socket event tests based on your GameServer implementation
	describe("Game events", () => {
		it("should handle game-specific events", (done) => {
			clientSocket.on("connect", () => {
				// Test your specific game events here
				// For example:
				clientSocket.emit("join-game", { gameId: "test" });

				clientSocket.on("game-joined", (data) => {
					expect(data).toBeDefined();
					done();
				});
			});
		});
	});
});
