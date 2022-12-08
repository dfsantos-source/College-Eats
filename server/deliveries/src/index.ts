import express, { Request, Response } from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { initRestaurants } from './initData';
import axios from 'axios';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());
const port = 4001;

console.log(process.env.DATABASE_URL);

async function connectDB(): Promise<MongoClient> {
  const uri = process.env.DATABASE_URL;

  if (uri === undefined) {
    throw Error('DATABASE_URL environment variable is not specified');
  }

  const mongo = new MongoClient(uri);
  await mongo.connect();
  return await Promise.resolve(mongo);
}


async function initDB(mongo: MongoClient) {
  const db = mongo.db();

  if (await db.listCollections({ name: 'restaurants' }).hasNext()) {
    console.log('Collection already exists. Skipping initialization.');
    return;
  }

  const products = db.collection('restaurants');
  const result = await products.insertMany(initRestaurants);

  console.log(`Initialized ${result.insertedCount} products`);
  console.log(`Initialized:`);

  for (let key in result.insertedIds) {
    console.log(`  Inserted product with Id ${result.insertedIds[key]}`);
  }
}

async function start() {
  const mongo = await connectDB();
  await initDB(mongo)

  app.get('/', (req: Request, res: Response) => {
    res.send({ message: 'ok' });
  });

  app.post('/events', async (req: Request, res: Response) => {
    const event = req.body;
    const delivery = event.data;
    if(event.type === "OrderProcessed"){
      if(delivery.status === "ordered"){
        delivery.userId = new ObjectId(delivery.userId);
        const db = mongo.db();
        const deliveries = db.collection("deliveries");
        await deliveries.insertOne(delivery);
        res.status(201).json({delivery: delivery, message: "Delivery successfully Added"});
      }
      else{
        res.status(404).send({ message: 'Insufficient Funds.' });
      }
    }
  });

  app.post('/api/delivery/create', (req: Request, res: Response) => {
    const body = req.body;
    if(body.userId !== null && body.time !== null && body.foods !== null && body.totalPrice !== null){
      const delivery = {
        type : "OrderCreated",
        data : {...body, type: "delivery"}
      }
      axios.post('http://eventbus:4000/events', delivery).catch((err) => {
        console.log(err.message);
      });
      res.status(201).json({delivery: delivery, message: "Delivery successfully Created"});
    }
    else{
      res.status(400).send({ message: 'Body not complete.' });
    }
  });

  app.put('/api/delivery/driver/assign', async (req: Request, res: Response) => {
    const body = req.body;
    const db = mongo.db();
    if(body._id !== null && body.driverId !== null){
      const deliveries = db.collection("deliveries");
      const updatedDeliveryDoc = await deliveries.findOneAndUpdate({_id: new ObjectId(body._id)}, {$set: {driverId: new ObjectId(body.driverId), status: "in transit"}}, {returnDocument : "after"});
      if(updatedDeliveryDoc === null){
        res.status(404).send({ message: 'Delivery not found.' });
      }
      else{
        const updatedDelivery = updatedDeliveryDoc.value;
        axios.post('http://eventbus:4000/events', updatedDelivery).catch((err) => {
          console.log(err.message);
        });
        res.status(200).json({delivery: updatedDelivery, message: 'Driver successfully assigned.' });
      }
    }
    else{
      res.status(400).send({ message: 'Body not complete.' });
    }
  });

  app.put('/api/delivery/complete', async (req: Request, res: Response) => {
    const body = req.body;
    const db = mongo.db();
    if(body._id !== null){
      const deliveries = db.collection("deliveries");
      const updatedDeliveryDoc = await deliveries.findOneAndUpdate({_id: new ObjectId(body._id)}, {$set: {status: "delivered"}}, {returnDocument : "after"});
      if(updatedDeliveryDoc === null){
        res.status(404).send({ message: 'Delivery not found.' });
      }
      else{
        const updatedDelivery = updatedDeliveryDoc.value;
        axios.post('http://eventbus:4000/events', updatedDelivery).catch((err) => {
          console.log(err.message);
        });
        res.status(200).json({delivery: updatedDelivery, message: 'Delivery has been completed.' });
      }
    }
    else{
      res.status(400).send({ message: 'Body not complete.' });
    }
  });

  const eventSubscriptions = ["OrderProcessed"];
  const eventURL = "http://deliveries:4001/events"

  await axios.post("http://eventbus:4000/subscribe", {
    eventTypes: eventSubscriptions,
    URL: eventURL
  })

  app.listen(port, () => {
    console.log(`Running on ${port}.`);
  });
}

start()