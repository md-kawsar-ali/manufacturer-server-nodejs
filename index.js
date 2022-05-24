const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Mongodb configuration
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jnwe0.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// Root Route
app.get('/', (req, res) => {
    res.send("Welcome to Autima Pro");
});

async function run() {
    try {
        await client.connect();
        const productCollection = client.db("AutimaPro").collection("products");

        app.get('/product', async (req, res) => {
            const size = parseInt(req.query.size);

            if (size) {
                const cursor = productCollection.find().sort({ '_id': -1 });
                const result = await cursor.limit(size).toArray();
                return res.send(result);
            }

            const result = await productCollection.find().sort({ '_id': -1 }).toArray();
            return res.send(result);
        });

    } finally {
        // await client.close();
    }
}

run().catch(console.dir);

// Listen Port
app.listen(port, () => {
    console.log('Manufacturer Server Running');
})