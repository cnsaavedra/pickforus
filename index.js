const app = require('express')();
const server = require('http').Server(app);
const io = require('socket.io')(server);
var MongoClient = require('mongodb').MongoClient;
var url = 'mongodb://localhost:27017/chat_database';


MongoClient.connect(url, function (err, db) {
    var messagesCollection = db.collection('messages');


    const tech = io.of('/tech');
    var topWords = {};


    tech.on('connection', (socket) => {

        //#TODO FIX THE SYNC OF THE TIMERS (maybe switch to sessionStorage?)
        socket.on('news', (data)=>{
           socket.emit('news_by_server', data.sec);
        });


        socket.on('join', (data) => {
            socket.join(data.room);
            tech.in(data.room).emit('message', 'New User Connected');
        });

        socket.on('message', (data) => {
            if (data.msg.trim().indexOf(' ') == -1) {
                messagesCollection.insertOne({text: data.msg}, function (err, res) {
                    console.log(data.msg + ' inserted into messagesCollection')
                });
            }
            else { // sentence includes more than one word
                var words = data.msg.split(" ");
                for (var i = 0; i < words.length; i++) {
                    console.log(words[i] + ' are the split messages');
                    if (words[i].length <= 3) {
                        console.log(words[i] + ' too short to be a food name')
                    }
                    else if (words[i].length >= 3 && words[i] !== "want" && words[i] !== "some" && words[i] !== "have" && isNaN(words[i])) {
                        messagesCollection.insertOne({text: words[i]}, function (err, res) {
                        });
                        console.log(words[i] + ' might be food so added to database')
                    }
                }
            }
            tech.in(data.room).emit('message', data.msg);
        });


        io.on('disconnect', () => {
            console.log('User Disconnected');
            tech.emit('message', 'User Disconnected');
        });


    });

    const port = 3000;

    server.listen(port, () => {
        console.log('Server is listening on Port: ${port}');
    });


    app.get('/', (req, res) => {
        res.sendFile(__dirname + '/public/index.html');
    });

    app.get('/food', (req, res) => {
        res.sendFile(__dirname + '/public/food.html');
    });
    app.get('/destination', (req, res) => {
        res.sendFile(__dirname + '/public/destination.html');
    });
    app.get('/pickforusplease', (req, res) => {
        res.sendFile(__dirname + '/public/pickforusplease.html');
    });

});

