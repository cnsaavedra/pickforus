import io from 'socket.io-client';
import React, {Component} from 'react';
import MessageBox from "./Message/MessageBox"
import MessageList from "./Message/MessageList"

const socket = io.connect('/tech');
const room = "food";

export default class Food extends Component{
    constructor (props) {
        super()
        this.state = {
            input: '',
            messages: []
        }
        this.sendMessage = this.sendMessage.bind(this)
    }

    componentDidMount() {
        socket.on('connect', ()=>{
            socket.emit('join', {room: room});  
        });
    }

    sendMessage(text) {
        socket.on('message', (text)=>{
            this.messages.push(text)
        });
    }

    render() {
        return(
            <div>
                <MessageList 
                    roomId={this.state.roomId}
                    messages={this.state.messages} />
                <MessageBox
                    sendMessage={this.sendMessage} />
            </div>
        )
    }
}