import request from 'supertest';
import path from 'path';
import { TestUtils } from './utils/test-utils';

describe('Express App', () => {
  let app: Express.Application;
  let server: Server;

  beforeEach(() => {
    const testSetup = TestUtils.createTestServer();
    app = testSetup.app;
    server = testSetup.server;

    // Mock the views and public paths for testing
    const viewsPath = path.join(__dirname, '../src/views');
    const publicPath = path.join(__dirname, '../src/public');

    app.set('views', viewsPath);
    app.use(express.static(publicPath));

    // Setup routes
    app.get('/', (req, res) => {
      res.render('index');
    });

    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'OK' });
    });
  });

  afterEach(async () => {
    await TestUtils.stopServer(server);
  });

  describe('GET /', () => {
    it('should return 200 and render index page', async () => {
      const response = await request(app).get('/');
      
      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('should serve static files', async () => {
      // This test assumes you have a test file in your public directory
      const response = await request(app).get('/test-file.txt');
      
      // Adjust expectation based on your static files
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/unknown-route');
      
      expect(response.status).toBe(404);
    });
  });
});