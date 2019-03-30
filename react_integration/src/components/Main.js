import React from "react";
import { BrowserRouter as Router, Route, Link } from "react-router-dom";
import 'typeface-roboto';
import Food from "./Food";

import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemIcon from '@material-ui/core/ListItemIcon';
import ListItemText from '@material-ui/core/ListItemText';
import MenuIcon from '@material-ui/icons/Menu';

function ListItemLink(props) {
  return <ListItem button component="a" {...props} />;
}

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
          <ListItem component={Link} to="/Food" button>
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

export default class Main extends React.Component {
  render(){
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
                <Route path="/Food" exact component={Food} />
                <Route path="/Destination" component={Destination} />
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


