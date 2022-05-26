const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Mongodb configuration
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jnwe0.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// Middleware
app.use(cors());
app.use(express.json());

// Verify JWT
const verifyJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'unauthorized' });
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.JWT_ACCESS_TOKEN, (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: 'forbidden' });
        }
        req.decoded = decoded;
        next();
    });
}

// Root Route
app.get('/', (req, res) => {
    res.send("Welcome to Autima Pro");
});

async function run() {
    try {
        await client.connect();
        const productCollection = client.db("AutimaPro").collection("products");
        const userCollection = client.db("AutimaPro").collection("user");
        const orderCollection = client.db("AutimaPro").collection("order");

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else {
                res.status(403).send({ message: 'forbidden access' });
            }
        }

        // Authentication
        app.put('/token/:email', async (req, res) => {
            const email = req.params.email;
            const { user } = req.body;

            const filter = {
                email: email
            }

            const updateDoc = {
                $set: {
                    email: user
                }
            }

            if (user && email) {
                const result = await userCollection.updateOne(filter, updateDoc, { upsert: true });
                const accessToken = jwt.sign({ email }, process.env.JWT_ACCESS_TOKEN, { expiresIn: '1d' });
                res.send({ result, accessToken });
            } else {
                res.send({ message: 'forbidden' })
            }
        });

        // Get Users
        app.get('/user', verifyJWT, verifyAdmin, async (req, res) => {
            const cursor = userCollection.find().sort({ '_id': -1 });
            const result = await cursor.toArray();
            res.send(result);
        });

        // Make Admin
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // Delete User
        app.delete('/user/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const result = await userCollection.deleteOne(filter);
            res.send(result);
        })

        // Get Admin or not
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user?.role === 'admin';
            res.send({ admin: isAdmin })
        })

        // Get Products
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

        // Get Product
        app.get('/product/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = {
                _id: ObjectId(id)
            }

            const result = await productCollection.findOne(query);
            res.send(result);
        });

        // Place Order
        app.post('/order', verifyJWT, async (req, res) => {
            const order = req.body;
            const filter = {
                _id: ObjectId(order?.productId)
            }

            const product = await productCollection.findOne(filter);
            const newQuantity = parseInt(product.quantity) - parseInt(order.quantity);
            if (newQuantity) {
                const updateDoc = {
                    $set: {
                        quantity: newQuantity
                    }
                }

                const updated = await productCollection.updateOne(filter, updateDoc);

                if (updated) {
                    const result = await orderCollection.insertOne(order);
                    res.send(result);
                }
            }
        });

        // Get Orders (Specific User)
        app.get('/order/:email', verifyJWT, async (req, res) => {
            const requester = req.decoded.email;
            const email = req.params.email;

            if (requester === email) {
                const filter = {
                    email: email
                }
                const cursor = orderCollection.find(filter).sort({ _id: -1 });
                const result = await cursor.toArray();

                return res.send(result);
            }
            return res.status(403).send({ message: 'forbidden' });
        });

        // Get Specific Order
        app.get('/myorder/:id', async (req, res) => {
            const id = req.params.id;
            const query = {
                _id: ObjectId(id)
            }

            const result = await orderCollection.findOne(query);
            res.send(result);
        });

        // Cancel Order
        app.delete('/order/:email', verifyJWT, async (req, res) => {
            const requester = req.decoded.email;
            const email = req.params.email;
            const { id } = req.body;
            const query = {
                _id: ObjectId(id)
            }

            if (requester === email) {
                const result = await orderCollection.deleteOne(query);
                return res.send(result);
            }
            return res.status(403).send({ message: 'forbidden' });
        });

        // Payment Intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseFloat(price) * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        // Insert Payment Info in Order
        app.put('/myorder/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const { transactionId, paid } = req.body;

            const filter = {
                _id: ObjectId(id)
            }

            const updateDoc = {
                $set: {
                    transactionId,
                    paid
                }
            }

            const result = await orderCollection.updateOne(filter, updateDoc, { upsert: true });
            res.send(result);
        })

    } finally {
        // await client.close();
    }
}

run().catch(console.dir);

// Listen Port
app.listen(port, () => {
    console.log('Manufacturer Server Running');
})