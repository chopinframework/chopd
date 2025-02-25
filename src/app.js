const express = require("express");
const cookieParser = require("cookie-parser");
const { createProxyMiddleware } = require("http-proxy-middleware");

// Import middleware
const authMiddleware = require("./middleware/auth");
const requestQueueMiddleware = require("./middleware/request-queue");

// Import routes
const { router: chopinRouter } = require("./routes/chopin");

/**
 * Create the Express application
 * @param {number} proxyPort - The port for the proxy server
 * @param {number} targetPort - The port for the target server
 * @returns {Object} Express app
 */
function createApp(proxyPort, targetPort) {
  const app = express();

  // Store ports in app settings
  app.set("proxyPort", proxyPort);
  app.set("targetPort", targetPort);

  // Parse cookies
  app.use(cookieParser());

  // Authentication middleware
  app.use(authMiddleware);

  // Chopin API routes
  app.use("/_chopin", express.json(), chopinRouter);

  // Request queue middleware for write operations
  app.use(requestQueueMiddleware);

  // Pass-through proxy for GET + websockets
  app.use(
    "/",
    createProxyMiddleware({
      target: `http://localhost:${targetPort}`,
      changeOrigin: true,
      ws: true,
    }),
  );

  // Fallback route
  app.use((req, res) => {
    console.log("[DEBUG] fallback route for", req.method, req.url);
    res.status(404).send("Not Found");
  });

  return app;
}

module.exports = createApp;
