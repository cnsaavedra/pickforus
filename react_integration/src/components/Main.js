import React from "react";
import { BrowserRouter as Router, Route, Link } from "react-router-dom";

import Food from "./Food";

function destination() {
  return <h2>Destination</h2>;
}

function pick() {
  return <h2>Pick For Us PLEASE</h2>;
}

function Header() {
  return (
    <ul>
      <li>
        <Link to="/Food">Food</Link>
      </li>
      <li>
        <Link to="/destination">Destination</Link>
      </li>
      <li>
        <Link to="/pickforusplease">Pick For Us Please</Link>
      </li>
    </ul>
  );
}

class Main extends React.Component {
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
                <Route path="/destination" component={destination} />
                <Route path="/pickforusplease" component={pick} />
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

export default Main;
