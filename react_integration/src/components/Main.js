import React from "react";
import { BrowserRouter as Router, Route, Link } from "react-router-dom";

function food() {
  return <h2>Food</h2>;
}

function destination() {
  return <h2>Destination</h2>;
}

function pick() {
  return <h2>Pick For Us PLEASE</h2>;
}

function MainRouter() {
  return (
    <Router>
      <div>
        <nav>
          <ul>
            <li>
              <Link to="/food">Home</Link>
            </li>
            <li>
              <Link to="/destination/">About</Link>
            </li>
            <li>
              <Link to="/pickforusplease/">Users</Link>
            </li>
          </ul>
        </nav>

        <Route path="/food" exact component={food} />
        <Route path="/destination" component={destination} />
        <Route path="/pickforusplease" component={pick} />
      </div>
    </Router>
  );
}

function Header() {
  return (
    <ul>
      <li>
        <Link to="/food">Food</Link>
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
  constructor (props) {
      super(props);

      this.state = {
      };
  }
  render () {
      return (
        <Router>
        <div>
          <Header />
          <Route exact path="/food" exact component={food} />
          <Route path="/destination" component={destination} />
          <Route path="/pickforusplease" component={pick} />
        </div>
      </Router>
      );
  }
}
export default Main;
