const app = require('express')();
const server = require('http').Server(app);
const io = require('socket.io')(server);
var MongoClient = require('mongodb').MongoClient;
var url = 'mongodb://localhost:3000/chat_database';


MongoClient.connect(url, function (err, db){
    var messagesCollection = db.collection('messages');


    const tech = io.of('/tech');
    var topWords = {};


    tech.on('connection', (socket)=>{
        socket.on('join', (data) =>{
            socket.join(data.room);
            tech.in(data.room).emit('message', 'New User Connected');
        });

        socket.on('message', (data)=>{

            messagesCollection.insertOne({text: data.msg}, function (err, res){
               console.log('inserted into messagesCollection')
            });
            tech.in(data.room).emit('message', data.msg);
            console.log(data.msg + " outside messageCollection");
        });

        io.on('disconnect', ()=>{
            console.log('User Disconnected');
            tech.emit('message', 'User Disconnected');
        });


    });

const port = 3000;

server.listen(port, ()=>{
    console.log('Server is listening on Port: ${port}');
});


app.get('/', (req, res)=>{
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/food', (req, res)=>{
    res.sendFile(__dirname + '/public/food.html');
});
app.get('/destination', (req, res)=>{
    res.sendFile(__dirname + '/public/destination.html');
});
app.get('/pickforusplease', (req, res)=>{
    res.sendFile(__dirname + '/public/pickforusplease.html');
});



});