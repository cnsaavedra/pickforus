import React from 'react';

const Food = () => {
        return (
                <div>
                <title>Chat About Food, anonymously</title>
                <h1>Talk about where or what to eat!</h1>
                <div className="container-fluid">
                    {/*For the messages that show in the chat-box*/}
                    <div className="row">
                    <ul id="server_messages" />
                    <ul id="messages" />
                    </div>
                    {/*Input form, message box and button*/}
                    <div className="row">
                    <div className="col-xs-12">
                        <form id="message-form" action>
                        <div className="input-group">
                            <input
                            id="m"
                            autoComplete="off"
                            type="text"
                            className="form-control"
                            placeholder="Message..."
                            aria-label="Message..."
                            />
                            <span className="input-group-btn">
                            <button className="btn btn-success" type="submit">
                                Send
                            </button>
                            </span>
                        </div>
                        </form>
                    </div>
                    </div>
                    {/*Overlay that will appear once time is up*/}
                    <div id="overlay">
                    <h1>Top 3:</h1>
                    <ol type={1}>
                        <li>
                        <span className="topFood1" />
                        </li>
                        <li>
                        <span id="topFood2" />
                        </li>
                        <li>
                        <span id="topFood3" />
                        </li>
                    </ol>
                    <h5>
                        <span id="duplicates" />
                    </h5>
                    <h6>
                        You should definitely go for some <span id="topFood" />{" "}
                        though!{" "}
                    </h6>
                    <a
                        id="a"
                        href="https://www.google.com/search?q="
                        target="_blank"
                        className="btn btn-info btn-md"
                    >
                        Suggestion
                    </a>
                    </div>
                </div>
                <div className="timer" />
                </div>
        )
}
export default Food;
