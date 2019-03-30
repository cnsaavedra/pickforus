import io from 'socket.io-client';
import React, {Component} from 'react';


const socket = io.connect('/tech');
var topFood;
var topFood1;
var topFood2;
var topFood3;


export default class Food extends Component{
    constructor (props) {
        super(props)

        this.state = {
            socket: null
        }
    }
    render() {
        return(
            <div>
            </div>
        )
    }
}