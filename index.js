const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 5000;
const NEWS_API_KEY = "c4bfc7a3273c460683c7f3c78c737624";
const NEWS_API_BASE_URL = "https://newsapi.org/v2";

// MongoDB connection
const uri =
  "mongodb+srv://countryDb:hXhi8dk7i4mcGbT9@flash0.nw85ito.mongodb.net/?appName=Flash0";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
async function connectDB() {
  try {
    await client.connect();
    db = client.db("newsApp");
    console.log("Connected to MongoDB!");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

// Helper function to store news articles in database
async function storeNewsArticles(articles, filters) {
  try {
    const newsCollection = db.collection("news");
    const articlesWithMetadata = articles.map((article) => ({
      ...article,
      fetchedAt: new Date(),
      filters: filters,
      _id: `${article.url}_${Date.now()}`, // Prevent duplicates
    }));

    // Use insertMany with ordered: false to continue on duplicates
    await newsCollection.insertMany(articlesWithMetadata, { ordered: false });
  } catch (error) {
    // Ignore duplicate key errors
    if (error.code !== 11000) {
      console.error("Error storing articles:", error);
    }
  }
}

// API Routes

// Get news with filters
app.get("/api/news", async (req, res) => {
  try {
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

    // Build News API URL
    let apiUrl = `${NEWS_API_BASE_URL}/top-headlines?apiKey=${NEWS_API_KEY}`;

    // Add parameters
    if (country) apiUrl += `&country=${country}`;
    if (category) apiUrl += `&category=${category}`;
    if (language) apiUrl += `&language=${language}`;
    if (sources) apiUrl += `&sources=${sources}`;
    if (q) apiUrl += `&q=${encodeURIComponent(q)}`;
    if (pageSize) apiUrl += `&pageSize=${pageSize}`;
    if (page) apiUrl += `&page=${page}`;

    // For date range, use everything endpoint
    if (from || to) {
      apiUrl = `${NEWS_API_BASE_URL}/everything?apiKey=${NEWS_API_KEY}`;
      if (q) apiUrl += `&q=${encodeURIComponent(q)}`;
      else apiUrl += `&q=*`; // everything endpoint requires a query
      if (language) apiUrl += `&language=${language}`;
      if (sources) apiUrl += `&sources=${sources}`;
      if (from) apiUrl += `&from=${from}`;
      if (to) apiUrl += `&to=${to}`;
      if (pageSize) apiUrl += `&pageSize=${pageSize}`;
      if (page) apiUrl += `&page=${page}`;
    }

    const response = await axios.get(apiUrl);

    if (response.data.status === "error") {
      return res.status(400).json({ error: response.data.message });
    }

    const articles = response.data.articles || [];

    // Store articles in database
    if (articles.length > 0) {
      await storeNewsArticles(articles, req.query);
    }

    res.json({
      status: "ok",
      totalResults: response.data.totalResults,
      articles: articles,
    });
  } catch (error) {
    console.error("Error fetching news:", error);
    res.status(500).json({
      error: "Failed to fetch news",
      message: error.response?.data?.message || error.message,
    });
  }
});

// Get available sources
app.get("/api/sources", async (req, res) => {
  try {
    const { country, language = "en", category } = req.query;

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
    console.error("Error fetching sources:", error);
    res.status(500).json({
      error: "Failed to fetch sources",
      message: error.response?.data?.message || error.message,
    });
  }
});

// Get stored news from database with filters
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

    // Build MongoDB query
    if (country) query["filters.country"] = country;
    if (category) query["filters.category"] = category;
    if (language) query["filters.language"] = language;
    if (source) query["source.name"] = new RegExp(source, "i");

    if (from || to) {
      query.publishedAt = {};
      if (from) query.publishedAt.$gte = new Date(from);
      if (to) query.publishedAt.$lte = new Date(to);
    }

    const articles = await newsCollection
      .find(query)
      .sort({ publishedAt: -1 })
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
    console.error("Error fetching stored news:", error);
    res.status(500).json({
      error: "Failed to fetch stored news",
      message: error.message,
    });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "News API server is running" });
});

// Start server
app.listen(PORT, async () => {
  await connectDB();
  console.log(`Server running on port ${PORT}`);
});
