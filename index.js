"use strict";

const utils = require("./utils");
const log = require("npmlog");

let checkVerified = null;

const defaultLogRecordSize = 100;
log.maxRecordSize = defaultLogRecordSize;

function setOptions(globalOptions, options) {
    Object.keys(options).map(function (key) {
        switch (key) {
            case 'online':
                globalOptions.online = Boolean(options.online);
                break;
            case 'logLevel':
                log.level = options.logLevel;
                globalOptions.logLevel = options.logLevel;
                break;
            case 'logRecordSize':
                log.maxRecordSize = options.logRecordSize;
                globalOptions.logRecordSize = options.logRecordSize;
                break;
            case 'selfListen':
                globalOptions.selfListen = Boolean(options.selfListen);
                break;
            case 'selfListenEvent':
                globalOptions.selfListenEvent = options.selfListenEvent;
                break;
            case 'listenEvents':
                globalOptions.listenEvents = Boolean(options.listenEvents);
                break;
            case 'pageID':
                globalOptions.pageID = options.pageID.toString();
                break;
            case 'updatePresence':
                globalOptions.updatePresence = Boolean(options.updatePresence);
                break;
            case 'forceLogin':
                globalOptions.forceLogin = Boolean(options.forceLogin);
                break;
            case 'userAgent':
                globalOptions.userAgent = options.userAgent;
                break;
            case 'autoMarkDelivery':
                globalOptions.autoMarkDelivery = Boolean(options.autoMarkDelivery);
                break;
            case 'autoMarkRead':
                globalOptions.autoMarkRead = Boolean(options.autoMarkRead);
                break;
            case 'listenTyping':
                globalOptions.listenTyping = Boolean(options.listenTyping);
                break;
            case 'proxy':
                if (typeof options.proxy != "string") {
                    delete globalOptions.proxy;
                    utils.setProxy();
                } else {
                    globalOptions.proxy = options.proxy;
                    utils.setProxy(globalOptions.proxy);
                }
                break;
            case 'autoReconnect':
                globalOptions.autoReconnect = Boolean(options.autoReconnect);
                break;
            case 'emitReady':
                globalOptions.emitReady = Boolean(options.emitReady);
                break;
            default:
                log.warn("setOptions", "Unrecognized option given to setOptions: " + key);
                break;
        }
    });
}

function buildAPI(globalOptions, html, jar) {
    const maybeCookie = jar.getCookies("https://www.facebook.com")
        .filter(function (val) {
            return val.cookieString().split("=")[0] === "c_user";
        });

    const objCookie = jar.getCookies("https://www.facebook.com")
        .reduce(function (obj, val) {
            obj[val.cookieString().split("=")[0]] = val.cookieString().split("=")[1];
            return obj;
        }, {});

    if (maybeCookie.length === 0) {
        throw {
            error: "Error retrieving userID. This can be caused by a lot of things, including getting blocked by Facebook or invalid cookies. " +
                   "Try logging in with a browser to verify you have a valid session."
        };
    }

    if (html.indexOf("/checkpoint/block/?next") > -1) {
        log.warn("login", "Checkpoint detected. Please log in with a browser to verify.");
    }

    const userID = maybeCookie[0].cookieString().split("=")[1].toString();
    const i_userID = objCookie.i_user || null;
    log.info("login", `Logged in as ${userID}`);

    try {
        clearInterval(checkVerified);
    } catch (_) { }

    const clientID = (Math.random() * 2147483648 | 0).toString(16);

    // Attempt to parse the Iris (MQTT) sequence ID and endpoint from the page HTML
    let mqttEndpoint = null;
    let region = null;
    let irisSeqID = null;
    let noMqttData = null;

    // New and legacy regex patterns to find Iris data
    const oldFBMQTTMatch = html.match(/irisSeqID:"(.+?)",appID:219994525426954,endpoint:"(.+?)"/);
    if (oldFBMQTTMatch) {
        irisSeqID = oldFBMQTTMatch[1];
        mqttEndpoint = oldFBMQTTMatch[2];
        region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
        log.info("login", `Got this account's message region: ${region}`);
    } else {
        const newFBMQTTMatch = html.match(/{"app_id":"219994525426954","endpoint":"(.+?)","iris_seq_id":"(.+?)"}/);
        if (newFBMQTTMatch) {
            irisSeqID = newFBMQTTMatch[2];
            mqttEndpoint = newFBMQTTMatch[1].replace(/\\\//g, "/");
            region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
            log.info("login", `Got this account's message region: ${region}`);
        } else {
            const updatedFBMQTTMatch = html.match(/"iris_seq_id":"(\d+)","app_id":"219994525426954","endpoint":"([^"]+)"/);
            if (updatedFBMQTTMatch) {
                irisSeqID = updatedFBMQTTMatch[1];
                mqttEndpoint = updatedFBMQTTMatch[2].replace(/\\\//g, "/");
                region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
                log.info("login", `Got this account's message region: ${region}`);
            } else {
                const legacyFBMQTTMatch = html.match(/(\["MqttWebConfig",\[\],{fbid:")(.+?)(",appID:219994525426954,endpoint:")(.+?)(",pollingEndpoint:")(.+?)(3790])/);
                if (legacyFBMQTTMatch) {
                    mqttEndpoint = legacyFBMQTTMatch[4];
                    region = new URL(mqttEndpoint).searchParams.get("region").toUpperCase();
                    log.warn("login", `Cannot get sequence ID with new RegExp. Fallback to old RegExp (without seqID)...`);
                    log.info("login", `Got this account's message region: ${region}`);
                    log.info("login", `[Unused] Polling endpoint: ${legacyFBMQTTMatch[6]}`);
                } else {
                    log.warn("login", "Cannot get MQTT region & sequence ID.");
                    noMqttData = html;
                }
            }
        }
    }

    // All data available to api functions
    const ctx = {
        userID: userID,
        i_userID: i_userID,
        jar: jar,
        clientID: clientID,
        globalOptions: globalOptions,
        loggedIn: true,
        access_token: 'NONE',
        clientMutationId: 0,
        mqttClient: undefined,
        lastSeqId: irisSeqID,
        syncToken: undefined,
        mqttEndpoint: mqttEndpoint,
        region: region,
        firstListen: true
    };

    const api = {
        setOptions: setOptions.bind(null, globalOptions),
        getAppState: function getAppState() {
            const appState = utils.getAppState(jar);
            // filter duplicates
            return appState.filter((item, index, self) => self.findIndex((t) => t.key === item.key) === index);
        }
    };

    if (noMqttData) {
        api["htmlData"] = noMqttData;
    }

    const apiFuncNames = [
        'addExternalModule',
        'addUserToGroup',
        'changeAdminStatus',
        'changeArchivedStatus',
        'changeAvatar',
        'changeBio',
        'changeBlockedStatus',
        'changeGroupImage',
        'changeNickname',
        'changeThreadColor',
        'changeThreadEmoji',
        'createNewGroup',
        'createPoll',
        'deleteMessage',
        'deleteThread',
        'forwardAttachment',
        'getCurrentUserID',
        'getEmojiUrl',
        'getFriendsList',
        'getMessage',
        'getThreadHistory',
        'getThreadInfo',
        'getThreadList',
        'getThreadPictures',
        'getUserID',
        'getUserInfo',
        'handleMessageRequest',
        'listenMqtt',
        'logout',
        'markAsDelivered',
        'markAsRead',
        'markAsReadAll',
        'markAsSeen',
        'muteThread',
        'refreshFb_dtsg',
        'removeUserFromGroup',
        'resolvePhotoUrl',
        'searchForThread',
        'sendMessage',
        'sendTypingIndicator',
        'setMessageReaction',
        'setPostReaction',
        'setTitle',
        'threadColors',
        'unsendMessage',
        'unfriend',
        // HTTP helpers
        'httpGet',
        'httpPost',
        'httpPostFormData',
        'uploadAttachment'
    ];

    const defaultFuncs = utils.makeDefaults(html, i_userID || userID, ctx);

    // Load all API functions
    apiFuncNames.forEach(function (v) {
        api[v] = require('./src/' + v)(defaultFuncs, api, ctx);
    });

    // For backward compatibility: use listenMqtt as listen()
    api.listen = api.listenMqtt;

    return [ctx, defaultFuncs, api];
}

// Helper for login: inject cookies or error
function loginHelper(appState, email, password, globalOptions, callback, prCallback) {
    let mainPromise = null;
    const jar = utils.getJar();

    // If cookies (appState) are provided, set them into the jar
    if (appState) {
        // Convert string or Array form of cookies to jar
        if (utils.getType(appState) === 'Array' && appState.some(c => c.name)) {
            appState = appState.map(c => {
                c.key = c.name;
                delete c.name;
                return c;
            });
        }
        else if (utils.getType(appState) === 'String') {
            const arrayAppState = [];
            appState.split(';').forEach(c => {
                const [key, value] = c.split('=');
                arrayAppState.push({
                    key: (key || "").trim(),
                    value: (value || "").trim(),
                    domain: "facebook.com",
                    path: "/",
                    expires: new Date().getTime() + 1000 * 60 * 60 * 24 * 365
                });
            });
            appState = arrayAppState;
        }

        appState.forEach(function (c) {
            const str = c.key + "=" + c.value + "; expires=" + c.expires + "; domain=" + c.domain + "; path=" + c.path + ";";
            jar.setCookie(str, "https://" + c.domain);
        });

        // Load the main Facebook page to initialize session
        mainPromise = utils
            .get('https://www.facebook.com/', jar, null, globalOptions, { noRef: true })
            .then(utils.saveCookies(jar));
    } else {
        // If no cookies, disallow email login
        if (email) {
            return callback({ error: "Login by email/password is not supported. Please use an appState (cookies) login." });
        } else {
            return callback({ error: "No appState (cookies) given. Cannot log in." });
        }
    }

    let ctx = null;
    let _defaultFuncs = null;
    let api = null;

    mainPromise = mainPromise
        .then(function (res) {
            // Some networks inject meta refresh redirects
            const reg = /<meta http-equiv="refresh" content="0;url=([^"]+)[^>]+>/;
            const redirect = reg.exec(res.body);
            if (redirect && redirect[1]) {
                return utils
                    .get(redirect[1], jar, null, globalOptions)
                    .then(utils.saveCookies(jar));
            }
            return res;
        })
        .then(function (res) {
            const html = res.body;
            const stuff = buildAPI(globalOptions, html, jar);
            ctx = stuff[0];
            _defaultFuncs = stuff[1];
            api = stuff[2];
            return res;
        });

    // If logging in as a page, open page's message inbox
    if (globalOptions.pageID) {
        mainPromise = mainPromise
            .then(function () {
                return utils.get('https://www.facebook.com/' + ctx.globalOptions.pageID + '/messages/?section=messages&subsection=inbox', ctx.jar, null, globalOptions);
            })
            .then(function (resData) {
                let url = utils.getFrom(resData.body, 'window.location.replace("https:\\/\\/www.facebook.com\\', '");');
                url = url.split('\\').join('');
                if (url.endsWith('/')) {
                    url = url.slice(0, -1);
                }
                return utils.get('https://www.facebook.com' + url, ctx.jar, null, globalOptions);
            });
    }

    mainPromise
        .then(function () {
            log.info("login", 'Done logging in.');
            return callback(null, api);
        })
        .catch(function (e) {
            log.error("login", e.error || e);
            callback(e);
        });
}

function login(loginData, options, callback) {
    // Allow loginData.cookies as alias for loginData.appState
    if (loginData && typeof loginData === 'object' && loginData.cookies && !loginData.appState) {
        loginData.appState = loginData.cookies;
    }

    if (utils.getType(options) === 'Function' || utils.getType(options) === 'AsyncFunction') {
        callback = options;
        options = {};
    }

    const globalOptions = {
        selfListen: false,
        selfListenEvent: false,
        listenEvents: false,
        listenTyping: false,
        updatePresence: false,
        forceLogin: false,
        autoMarkDelivery: true,
        autoMarkRead: false,
        autoReconnect: true,
        logRecordSize: defaultLogRecordSize,
        online: true,
        emitReady: false,
        // Updated userAgent to modern Chrome
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                   "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    setOptions(globalOptions, options);

    let prCallback = null;
    if (utils.getType(callback) !== "Function" && utils.getType(callback) !== "AsyncFunction") {
        let rejectFunc = null;
        let resolveFunc = null;
        var returnPromise = new Promise(function (resolve, reject) {
            resolveFunc = resolve;
            rejectFunc = reject;
        });
        prCallback = function (error, api) {
            if (error) {
                return rejectFunc(error);
            }
            return resolveFunc(api);
        };
        callback = prCallback;
    }

    loginHelper(loginData.appState, loginData.email, loginData.password, globalOptions, callback, prCallback);
    return returnPromise;
}

module.exports = login;
