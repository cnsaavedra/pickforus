const app = require('express')();
const server = require('http').Server(app);
const io = require('socket.io')(server);

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


const tech = io.of('/tech');

tech.on('connection', (socket)=>{
    socket.on('join', (data) =>{
        socket.join(data.room);
        tech.in(data.room).emit('message', 'New User Connected');
    });

    socket.on('message', (data)=>{
        tech.in(data.room).emit('message', data.msg);
    });

    io.on('disconnect', ()=>{
        console.log('User Disconnected');
        tech.emit('message', 'User Disconnected');
    });

});