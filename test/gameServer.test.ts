import { Server } from "socket.io";
import { GameServer } from "../src/game/gameServer";

// Mock socket.io
jest.mock("socket.io");

describe("GameServer", () => {
	let mockIo: jest.Mocked<Server>;
	let gameServer: GameServer;

	beforeEach(() => {
		mockIo = {
			on: jest.fn(),
			// Add other methods you use from socket.io
		} as any;

		gameServer = new GameServer(mockIo);
	});

	it("should initialize with socket.io server", () => {
		expect(gameServer).toBeInstanceOf(GameServer);
		expect(mockIo.on).toHaveBeenCalledWith("connection", expect.any(Function));
	});

	it("should handle connection events", () => {
		const connectionHandler = mockIo.on.mock.calls[0][1];
		const mockSocket = {
			on: jest.fn(),
			id: "test-socket-id",
		};

		connectionHandler(mockSocket);

		expect(mockSocket.on).toHaveBeenCalledWith(
			"disconnect",
			expect.any(Function),
		);
		// Add more assertions based on your connection handling logic
	});

	// Add more unit tests for GameServer methods
});
