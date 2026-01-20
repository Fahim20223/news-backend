const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 5000;

// TODO: Move this to environment variables for production
const NEWS_API_KEY = "c4bfc7a3273c460683c7f3c78c737624";
const NEWS_API_BASE_URL = "https://newsapi.org/v2";

// Database connection string - should be in .env file in production
const uri =
  "mongodb+srv://countryDb:hXhi8dk7i4mcGbT9@flash0.nw85ito.mongodb.net/?appName=Flash0";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db; // Global database connection

// Basic middleware setup
app.use(cors());
app.use(express.json());

// Initialize database connection
async function connectDB() {
  try {
    await client.connect();
    db = client.db("newsApp");
    console.log("✅ Successfully connected to MongoDB!");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1); // Exit if we can't connect to database
  }
}

// Store news articles in MongoDB with metadata
async function storeNewsArticles(articles, filters) {
  try {
    const newsCollection = db.collection("news");
    
    // Add some metadata to each article before storing
    const articlesWithMetadata = articles.map((article) => ({
      ...article,
      fetchedAt: new Date(),
      filters: filters,
      // Create unique ID to prevent duplicates
      _id: `${article.url}_${Date.now()}`,
    }));

    // Insert articles, skip duplicates if they exist
    await newsCollection.insertMany(articlesWithMetadata, { 
      ordered: false 
    });
  } catch (error) {
    // It's okay if some articles are duplicates
    if (error.code !== 11000) {
      console.error("Error storing articles:", error);
    }
  }
}

// API Routes

// Main endpoint to fetch news with various filters
app.get("/api/news", async (req, res) => {
  try {
    // Extract query parameters with defaults
    const {
      country = "us",
      category,
      language = "en",
      sources,
      from,
      to,
      q,
      pageSize = 20,
      page = 1,
    } = req.query;

    // Start building the News API URL
    let apiUrl = `${NEWS_API_BASE_URL}/top-headlines?apiKey=${NEWS_API_KEY}`;

    // Add query parameters one by one
    if (country) apiUrl += `&country=${country}`;
    if (category) apiUrl += `&category=${category}`;
    if (language) apiUrl += `&language=${language}`;
    if (sources) apiUrl += `&sources=${sources}`;
    if (q) apiUrl += `&q=${encodeURIComponent(q)}`;
    if (pageSize) apiUrl += `&pageSize=${pageSize}`;
    if (page) apiUrl += `&page=${page}`;

    // If user wants date filtering, we need to use the 'everything' endpoint
    if (from || to) {
      apiUrl = `${NEWS_API_BASE_URL}/everything?apiKey=${NEWS_API_KEY}`;
      // Everything endpoint requires a search query
      if (q) {
        apiUrl += `&q=${encodeURIComponent(q)}`;
      } else {
        apiUrl += `&q=*`; // Search everything
      }
      
      if (language) apiUrl += `&language=${language}`;
      if (sources) apiUrl += `&sources=${sources}`;
      if (from) apiUrl += `&from=${from}`;
      if (to) apiUrl += `&to=${to}`;
      if (pageSize) apiUrl += `&pageSize=${pageSize}`;
      if (page) apiUrl += `&page=${page}`;
    }

    // Make the API call
    const response = await axios.get(apiUrl);

    // Check if the API returned an error
    if (response.data.status === "error") {
      return res.status(400).json({ error: response.data.message });
    }

    const articles = response.data.articles || [];

    // Save articles to our database for future reference
    if (articles.length > 0) {
      await storeNewsArticles(articles, req.query);
    }

    // Send response back to client
    res.json({
      status: "ok",
      totalResults: response.data.totalResults,
      articles: articles,
    });
  } catch (error) {
    console.error("News fetch error:", error);
    res.status(500).json({
      error: "Failed to fetch news",
      message: error.response?.data?.message || error.message,
    });
  }
});

// Endpoint to get available news sources
app.get("/api/sources", async (req, res) => {
  try {
    const { country, language = "en", category } = req.query;

    // Build the sources API URL
    let apiUrl = `${NEWS_API_BASE_URL}/sources?apiKey=${NEWS_API_KEY}`;
    if (country) apiUrl += `&country=${country}`;
    if (language) apiUrl += `&language=${language}`;
    if (category) apiUrl += `&category=${category}`;

    const response = await axios.get(apiUrl);

    res.json({
      status: "ok",
      sources: response.data.sources || [],
    });
  } catch (error) {
    console.error("Sources fetch error:", error);
    res.status(500).json({
      error: "Failed to fetch sources",
      message: error.response?.data?.message || error.message,
    });
  }
});

// Get previously stored news from our database
app.get("/api/news/stored", async (req, res) => {
  try {
    const {
      country,
      category,
      language,
      source,
      from,
      to,
      limit = 20,
      skip = 0,
    } = req.query;

    const newsCollection = db.collection("news");
    let query = {};

    // Build MongoDB query based on filters
    if (country) query["filters.country"] = country;
    if (category) query["filters.category"] = category;
    if (language) query["filters.language"] = language;
    if (source) query["source.name"] = new RegExp(source, "i"); // Case-insensitive search

    // Handle date range filtering
    if (from || to) {
      query.publishedAt = {};
      if (from) query.publishedAt.$gte = new Date(from);
      if (to) query.publishedAt.$lte = new Date(to);
    }

    // Execute the query
    const articles = await newsCollection
      .find(query)
      .sort({ publishedAt: -1 }) // Most recent first
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .toArray();

    const total = await newsCollection.countDocuments(query);

    res.json({
      status: "ok",
      totalResults: total,
      articles: articles,
    });
  } catch (error) {
    console.error("Database query error:", error);
    res.status(500).json({
      error: "Failed to fetch stored news",
      message: error.message,
    });
  }
});

// Simple health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "News API server is running",
    timestamp: new Date().toISOString()
  });
});

// Start the server
app.listen(PORT, async () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  await connectDB();
});
