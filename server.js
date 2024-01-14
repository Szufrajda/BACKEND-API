const express = require('express');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');

const app = express();
const port = 3001;

app.use('/swag', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'productsDB';
const collectionName = 'products';

app.use(express.json());

const client = new MongoClient(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true });

client.connect()
    .then(async () => {
        console.log('Połączenie z bazą danych udane');

        const db = client.db(dbName);

        const collection = db.collection(collectionName);

        const result = await collection.deleteMany({});

        console.log(`${result.deletedCount} produkty zostały usunięte z kolekcji.`);

        const count = await collection.countDocuments();
        if (count === 0) {
            const data = fs.readFileSync('products.json', 'utf8');
            const productsData = JSON.parse(data);

            // Dodaj pole 'id' do danych produktów
            productsData.forEach((product, index) => {
                product.id = index + 1;
            });

            const result = collection.insertMany(productsData);

            console.log(`${result.insertedCount} produkty zostały dodane do kolekcji.`);
        } else {
            console.log('Kolekcja już zawiera produkty, pomijam dodawanie.');
        }

        app.get('/products', async (req, res) => {
            try {
                const { name, minPrice, maxPrice, minQuantity, maxQuantity } = req.query;

                const filter = {};
                if (name) {
                    filter.name = { $regex: new RegExp(name, 'i') };
                }
                if (minPrice) {
                    filter.price = { $gte: parseFloat(minPrice) };
                }
                if (maxPrice) {
                    filter.price = { ...filter.price, $lte: parseFloat(maxPrice) };
                }
                if (minQuantity) {
                    filter.quantity = { $gte: parseInt(minQuantity) };
                }
                if (maxQuantity) {
                    filter.quantity = { ...filter.quantity, $lte: parseInt(maxQuantity) };
                }

                const products = await db.collection('products').find(filter).toArray();

                // Nie wyświetlaj '_id', a zamiast tego użyj 'id'
                const formattedProducts = products.map(({ _id, ...rest }) => rest);

                res.json(formattedProducts);
            } catch (error) {
                console.error('Błąd podczas pobierania produktów:', error);
                res.status(500).send('Błąd serwera');
            }
        });

        app.post('/products', async (req, res) => {
            try {
                const { name, price, description, quantity, unit } = req.body;

                const existingProduct = await db.collection('products').findOne({ name });

                if (existingProduct) {
                    return res.status(400).json({ error: 'Produkt o podanej nazwie już istnieje.' });
                }

                // Pobierz ostatni używany 'id' lub ustaw na 0, jeśli nie ma produktów
                const lastUsedId = await db.collection('products').find().sort({ id: -1 }).limit(1).toArray();
                const newId = (lastUsedId.length > 0) ? lastUsedId[0].id + 1 : 1;

                const result = await db.collection('products').insertOne({
                    id: newId,
                    name,
                    price: parseFloat(price),
                    description,
                    quantity: parseInt(quantity),
                    unit,
                });

                console.log(`Dodano nowy produkt: ${name}`);
                res.status(201).json({ message: 'Produkt dodany pomyślnie.' });
            } catch (error) {
                console.error('Błąd podczas dodawania produktu:', error);
                res.status(500).send('Błąd serwera');
            }
        });

        app.put('/products/:id', async (req, res) => {
            try {
                const productId = req.params.id;
                const { name, price, description, quantity, unit } = req.body;

                const existingProduct = await db.collection('products').findOne({ id: parseInt(productId) });

                if (!existingProduct) {
                    return res.status(404).json({ error: 'Produkt o podanym identyfikatorze nie istnieje.' });
                }

                const updateResult = await db.collection('products').updateOne(
                    { id: parseInt(productId) },
                    {
                        $set: {
                            name: name || existingProduct.name,
                            price: parseFloat(price) || existingProduct.price,
                            description: description || existingProduct.description,
                            quantity: parseInt(quantity) || existingProduct.quantity,
                            unit: unit || existingProduct.unit,
                        },
                    }
                );

                if (updateResult.modifiedCount > 0) {
                    console.log(`Zaktualizowano produkt o identyfikatorze ${productId}`);
                    res.json({ message: 'Produkt zaktualizowany pomyślnie.' });
                } else {
                    console.log(`Nie dokonano zmian w produkcie o identyfikatorze ${productId}`);
                    res.json({ message: 'Brak zmian w produkcie.' });
                }
            } catch (error) {
                console.error('Błąd podczas aktualizacji produktu:', error);
                res.status(500).send('Błąd serwera');
            }
        });

        app.delete('/products/:id', async (req, res) => {
            try {
                const productId = req.params.id;

                const existingProduct = await db.collection('products').findOne({ id: parseInt(productId) });

                if (!existingProduct) {
                    return res.status(404).json({ error: 'Produkt o podanym identyfikatorze nie istnieje.' });
                }

                const deleteResult = await db.collection('products').deleteOne({ id: parseInt(productId) });

                if (deleteResult.deletedCount > 0) {
                    console.log(`Usunięto produkt o identyfikatorze ${productId}`);
                    res.json({ message: 'Produkt usunięty pomyślnie.' });
                } else {
                    console.log(`Nie dokonano zmian w produkcie o identyfikatorze ${productId}`);
                    res.json({ message: 'Brak zmian w produkcie.' });
                }
            } catch (error) {
                console.error('Błąd podczas usuwania produktu:', error);
                res.status(500).send('Błąd serwera');
            }
        });

        // Nowa ścieżka dla raportu stanu magazynu
        app.get('/inventory-report', async (req, res) => {
            try {
                const pipeline = [
                    {
                        $group: {
                            _id: null,
                            totalQuantity: { $sum: "$quantity" },
                            totalValue: { $sum: { $multiply: ["$quantity", "$price"] } }
                        }
                    }
                ];

                const reportResult = await db.collection('products').aggregate(pipeline).toArray();

                if (reportResult.length > 0) {
                    res.json({
                        totalQuantity: reportResult[0].totalQuantity,
                        totalValue: reportResult[0].totalValue
                    });
                } else {
                    res.json({
                        totalQuantity: 0,
                        totalValue: 0
                    });
                }
            } catch (error) {
                console.error('Błąd podczas generowania raportu:', error);
                res.status(500).send('Błąd serwera');
            }
        });

        process.on('SIGINT', () => {
            client.close();
            console.log('Połączenie z bazą danych zamknięte, aplikacja zakończona.');
            process.exit();
        });

        app.listen(port, () => {
            console.log(`Serwer Express działa na http://localhost:${port}`);
        });
    })
    .catch(err => {
        console.error('Błąd połączenia z bazą danych:', err);
    });
