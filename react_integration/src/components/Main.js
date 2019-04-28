import React from "react"
import { BrowserRouter as Router, Route, Link } from "react-router-dom"
import 'typeface-roboto'
import Food from "./Food"

import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemIcon from '@material-ui/core/ListItemIcon';
import ListItemText from '@material-ui/core/ListItemText';
import MenuIcon from '@material-ui/icons/Menu';
import socketIOClient from "socket.io-client";

function Destination() {
  return <h2>Destination</h2>;
}

function Pick() {
  return <h2>Pick For Us PLEASE</h2>;
}

function Header() {
  return (
    <div>
      <List component="nav">
          <ListItem component={Link} to="/food" button>
            <ListItemIcon>
              <MenuIcon />
            </ListItemIcon>
            <ListItemText primary="Food" />
          </ListItem>
          <ListItem component={Link} to="/destination" button>
            <ListItemIcon>
              <MenuIcon />
            </ListItemIcon>
            <ListItemText primary="Destination" />
          </ListItem>
          <ListItem component={Link} to="/pick" button>
            <ListItemIcon>
              <MenuIcon />
            </ListItemIcon>
            <ListItemText primary="Pick For Us" />
          </ListItem>
      </List>
    </div>
  )
}
var socket;
class Main extends React.Component {
  constructor() {
    super();
    this.state = {
      endpoint: 'http://localhost:3001/'
    }
    socket = socketIOClient(this.state.endpoint);
  }

  render() {
    return (
      <div>
        <meta charSet="UTF-8" />
        <title>Pick For Us</title>
        <div className="container">
          <main role="main" className="inner cover">
            <h1 className="cover-heading">Pick For Us</h1>
            <p className="lead" />
            <p className="lead">
            </p><ul>
            <Router>
              <div>
                <Header />
                <Route path="/food" exact component={Food} />
                <Route path="/destination" component={Destination} />
                <Route path="/pick" component={Pick} />
              </div>
              </Router>
            </ul>
            <p />
          </main>
        </div>
      </div>
    )
  }
}
export { Main, socket }
