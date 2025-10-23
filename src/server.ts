import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { engine } from "express-handlebars";
import path from "path";
import { GameServer } from "./game/gameServer";

/**
 * Express application instance
 * @type {express.Application}
 */
const app = express();

/**
 * HTTP server instance for Socket.IO
 * @type {http.Server}
 */
const httpServer = createServer(app);

/**
 * Socket.IO server instance for real-time communication
 * @type {Server}
 */
const io = new Server(httpServer);

/**
 * Handlebars template engine setup
 * Configures Express to use Handlebars as the view engine
 * 
 * @configuration
 * - defaultLayout: false - No default layout to keep it simple
 * - extname: ".handlebars" - File extension for Handlebars templates
 */
app.engine(
	"handlebars",
	engine({
		defaultLayout: false,
		extname: ".handlebars",
	}),
);

/**
 * Set Handlebars as the default view engine
 */
app.set("view engine", "handlebars");

/**
 * Determine if the application is running in production mode
 * Checks if the __dirname includes "dist" which indicates compiled JavaScript
 * @type {boolean}
 */
const isProduction = __dirname.includes("dist");

/**
 * Configure views directory path based on environment
 * - Production: Uses compiled JavaScript in dist folder
 * - Development: Uses TypeScript source files
 * @type {string}
 */
const viewsPath = isProduction
	? path.join(__dirname, "../views")
	: path.join(__dirname, "./views");

/**
 * Configure public assets directory path based on environment
 * - Production: Uses compiled JavaScript in dist folder
 * - Development: Uses TypeScript source files
 * @type {string}
 */
const publicPath = isProduction
	? path.join(__dirname, "../public")
	: path.join(__dirname, "./public");

/**
 * Set the views directory for Express
 * @param {string} viewsPath - Path to the views directory
 */
app.set("views", viewsPath);

/**
 * Serve static files from the public directory
 * This includes CSS, client-side JavaScript, images, etc.
 * @middleware
 */
app.use(express.static(publicPath));

/**
 * Root route handler
 * Renders the main game page using Handlebars template
 * 
 * @route GET /
 * @param {express.Request} req - Express request object
 * @param {express.Response} res - Express response object
 */
app.get("/", (req, res) => {
	res.render("index");
});

/**
 * Game server instance
 * Handles all game logic, player management, and real-time game events
 * @type {GameServer}
 */
const gameServer = new GameServer(io);

/**
 * Server port configuration
 * Uses environment variable PORT if available, otherwise defaults to 3000
 * @type {number|string}
 */
const PORT = process.env.PORT || 3000;

/**
 * Start the HTTP server
 * Listens on the configured port and logs server status
 * 
 * @event listening - Emitted when server starts successfully
 * @callback - Executed when server is ready to accept connections
 */
httpServer.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
});

/**
 * Server Error Handling
 * Gracefully handle server errors and cleanup
 */

/**
 * Handle uncaught exceptions to prevent server crashes
 * @event uncaughtException
 */
process.on('uncaughtException', (error) => {
	console.error('Uncaught Exception:', error);
	// Perform cleanup if needed
	process.exit(1);
});

/**
 * Handle unhandled promise rejections
 * @event unhandledRejection
 */
process.on('unhandledRejection', (reason, promise) => {
	console.error('Unhandled Rejection at:', promise, 'reason:', reason);
	// Application specific logging, throwing an error, or other logic here
});

/**
 * Graceful shutdown handling
 * Clean up resources when the process is about to exit
 * @event SIGINT - Interrupt signal (Ctrl+C)
 * @event SIGTERM - Termination signal
 */
process.on('SIGINT', () => {
	console.log('\nReceived SIGINT. Shutting down gracefully...');
	httpServer.close(() => {
		console.log('HTTP server closed.');
		process.exit(0);
	});
});

process.on('SIGTERM', () => {
	console.log('Received SIGTERM. Shutting down gracefully...');
	httpServer.close(() => {
		console.log('HTTP server closed.');
		process.exit(0);
	});
});

// Export the app for testing purposes
export default app;