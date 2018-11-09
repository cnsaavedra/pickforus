const app = require('express')();
var express = require('express');
const server = require('http').Server(app);
const io = require('socket.io')(server);
var MongoClient = require('mongodb').MongoClient;
var url = 'mongodb://localhost:27017/chat_database';
var router = express.Router();
var assert = require('assert');


MongoClient.connect(url, function (err, db) {
    var messagesCollection = db.collection('messages');


    const tech = io.of('/tech');
    var connections = [];
    var timer = 2;


    tech.on('connection', (socket) => {
        connections.push(socket);
        console.log("Connections: " + connections.length);


        //FOR TIMER
        var ChatCountdown = setInterval(function(){
            socket.emit('time_server', timer);
            timer--; // had to remove the if (timer > 0) because it creates two multiples of else if(timer === 0)(figure out why later)
            if(timer === 0 || timer < 0){
                socket.emit('time_server', timer);
                clearInterval(ChatCountdown);
            }
            }, 1000);



        socket.on('join', (data) => {
            socket.join(data.room);
            tech.in(data.room).emit('server_message', connections.length + ' users connected');
        });

        socket.on('message', (data) => {
            // includes/excludes words (compare to a dictionary later) to database
            if (data.msg.trim().indexOf(' ') == -1) {
                if(data.msg.length <= 3){
                    console.log(data.msg + ' too short to be a food name')
                }
                else if(data.msg.length >= 3 && data.msg !== "want" && data.msg !== "some" && data.msg !== "have" && data.msg !== "test") {
                    messagesCollection.insertOne({text: data.msg}, function (err, res) {
                        console.log(data.msg + ' inserted into messagesCollection')
                    });
                    console.log(data.msg + ' might be food so added to database')
                }
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
    var topFood = 0;
    var topFood2 = 0;
    var topFood3 = 0;
    var topFoodArray = 0;
    var top2FoodArray = 0;
    var top3FoodArray = 0;
    var top3 = [];
    var top3Arrays = [];


    server.listen(port, () => {
        console.log('Server is listening on Port: ${port}');
    });

    app.get('/get-data', function(req, res, next) {
        db.collection("messages", function (err, collection) {
            collection.aggregate([{$group: {_id: "$text", MyResults: {$sum: 1}}}]).toArray(function (err, data) {

                //puts all the count of each food in an array through numbers
                for(var i =0; i < data.length; i++){
                    if(data[i].MyResults > topFood){
                        topFoodArray = i;
                    }
                    top3Arrays.push(data[i].MyResults)
                }
                //#TODO SHIT IT MESSY HERE TRY TO GET TOP 3
                console.log("All Counts: " + top3Arrays);
                // this gets the MyResult top 3 (not the id)
                var topValues = top3Arrays.sort((a,b) => a<b).slice(0,3);
                //now that got top 3 MyResult, get its respective id
                console.log("Top 3 Counts: " + topValues);
                console.log("Top 1 Count respective MyResult: " + topValues[0]);

                for(var y=0; y<topValues.length; y++){
                    top3[y] = data[y];
                    console.log("HERE "+data[topValues[y]]);
                }


                topFood = data[topFoodArray]._id;
                topFood2 = data[top2FoodArray]._id;
                topFood3 = data[top3FoodArray]._id;
                top3[0] = topFood;
                top3[1] = topFood2;
                top3[2] = topFood3;
                console.log("Top Food: " + top3[0]);
                res.json(top3);
            })
        });
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