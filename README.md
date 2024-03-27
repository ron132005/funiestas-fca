# Facebook Chat API (Unofficial)
<img alt="version" src="https://img.shields.io/github/package-json/v/fb-chat-api/fb-chat-api?label=github&style=flat-square">

META now has an official API for Facbook bots [here](https://developers.facebook.com/docs/messenger-platform).

This API is the only way to automate chat functionalities on a user account. We do this by emulating the browser. This means doing the exact same GET/POST requests and tricking Facebook into thinking we're accessing the website normally. Because we're doing it this way, this API won't work with an auth token but requires the credentials of a Facebook account (COOKIES).

_Disclaimer_: We are not responsible if your account gets banned for spammy activities such as sending lots of messages to people you don't know, sending messages very quickly, sending spammy looking URLs, logging in and out very quickly... Be responsible Facebook citizens.

## Install

### Bleeding edge
If you want to use bleeding edge (directly from github) to test new features or submit bug report, this is the command for you:
```bash
npm install ron132005/funiestas-fca
```
### Note
**Currently, this repo is not available on NPM. Please use the bleeding edge version.**

## Example Usage
### Note
**Logging in with appstate is the only way available. You need to create a file named `appstate.json` to save your login state. You can use [c3c-fbstate](https://github.com/c3cbot/c3c-fbstate) to get fbstate.json (appstate.json)**

```javascript
const login = require("funiestas-fca");

// Create simple echo bot
login({email: "FB_EMAIL", password: "FB_PASSWORD"}, (err, api) => {
    if(err) return console.error(err);

    api.listen((err, message) => {
        api.sendMessage(message.body, message.threadID);
    });
});
```

Or use `appstate.json` to save your login state:

```javascript
const login = require("funiestas-fca");
const fs = require("fs");

// Create simple echo bot
login({appState: JSON.parse(fs.readFileSync('appstate.json', 'utf8'))}, (err, api) => {
		if(err) return console.error(err);
		console.log("Logged in!");

		api.listen((err, message) => {
				api.sendMessage(message.body, message.threadID);
		});
});
```

Result:

<img width="517" alt="screen shot 2016-11-04 at 14 36 00" src="https://cloud.githubusercontent.com/assets/4534692/20023545/f8c24130-a29d-11e6-9ef7-47568bdbc1f2.png">


## Documentation

You can see it [here](DOCS.md).

## Main Functionality

### Sending a message
#### api.sendMessage(message, threadID, [callback], [messageID])

Various types of message can be sent:
* *Regular:* set field `body` to the desired message as a string.
* *Sticker:* set a field `sticker` to the desired sticker ID.
* *File or image:* Set field `attachment` to a readable stream or an array of readable streams.
* *URL:* set a field `url` to the desired URL.
* *Emoji:* set field `emoji` to the desired emoji as a string and set field `emojiSize` with size of the emoji (`small`, `medium`, `large`)

Note that a message can only be a regular message (which can be empty) and optionally one of the following: a sticker, an attachment or a url.

__Tip__: to find your own ID, you can look inside the cookies. The `userID` is under the name `c_user`.

__Basic Message Example__
```js
const login = require("fb-chat-api-temp");

login({email: "FB_EMAIL", password: "FB_PASSWORD"}, (err, api) => {
    if(err) return console.error(err);

    var yourID = "000000000000000";
    var msg = "Hey!";
    api.sendMessage(msg, yourID);
});
```

__Upload Message Attachment Example__
```js
const login = require("fb-chat-api-temp");

login({email: "FB_EMAIL", password: "FB_PASSWORD"}, (err, api) => {
    if(err) return console.error(err);

    // Note this example uploads an image called image.jpg
    var yourID = "000000000000000";
    var msg = {
        body: "Hey!",
        attachment: fs.createReadStream(__dirname + '/image.jpg')
    }
    api.sendMessage(msg, yourID);
});
```

------------------------------------
### Saving session.

To avoid logging in every time you should save AppState (cookies etc.) to a file, then you can use it without having password in your scripts.

__Example__

```js
const fs = require("fs");
const login = require("funiestas-fca");

var credentials = {email: "FB_EMAIL", password: "FB_PASSWORD"};

login(credentials, (err, api) => {
    if(err) return console.error(err);

    fs.writeFileSync('appstate.json', JSON.stringify(api.getAppState()));
});
```

Alternative: Use [c3c-fbstate](https://github.com/lequanglam/c3c-fbstate) to get fbstate.json (appstate.json)

------------------------------------

### Listening to a chat
#### api.listenMqtt(callback)

Listen watches for messages sent in a chat. By default this won't receive events (joining/leaving a chat, title change etc…) but it can be activated with `api.setOptions({listenEvents: true})`. This will by default ignore messages sent by the current account, you can enable listening to your own messages with `api.setOptions({selfListen: true})`.

__Example__

```js
const fs = require("fs");
const login = require("fb-chat-api-temp");

// Simple echo bot. It will repeat everything that you say.
// Will stop when you say '/stop'
login({appState: JSON.parse(fs.readFileSync('appstate.json', 'utf8'))}, (err, api) => {
    if(err) return console.error(err);

    api.setOptions({listenEvents: true});

    var stopListening = api.listenMqtt((err, event) => {
        if(err) return console.error(err);

        api.markAsRead(event.threadID, (err) => {
            if(err) console.error(err);
        });

        switch(event.type) {
            case "message":
                if(event.body === '/stop') {
                    api.sendMessage("Goodbye…", event.threadID);
                    return stopListening();
                }
                api.sendMessage("TEST BOT: " + event.body, event.threadID);
                break;
            case "event":
                console.log(event);
                break;
        }
    });
});
```

## FAQS

1. Why doesn't `sendMessage` always work when I'm logged in as a page?
> Pages can't start conversations with users directly; this is to prevent pages from spamming users.

2. What do I do when `login` doesn't work?
> First check that you can login to Facebook using the website. If login approvals are enabled, you might be logging in incorrectly. For how to handle login approvals, read our docs on [`login`](DOCS.md#login).

3. Do you support sending messages as a page?
> No.

4. I don't want all of these logging messages!
> You can use `api.setOptions` to silence the logging. You get the `api` object from `login` (see example above). Do
> ```js
> api.setOptions({
>     logLevel: "silent"
> });
> ```
