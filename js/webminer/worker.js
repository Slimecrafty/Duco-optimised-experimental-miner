importScripts("hashes.js");

function getTime() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

onmessage = function(event) {
    if (!event.data.startsWith("Start")) return;

    const getData  = event.data.split(",");
    const username = getData[1];
    const rigid    = getData[2] || "None";
    const workerVer = getData[3];
    const wallet_id = getData[4];
    const miner_key = getData[5] || "";

    let result = 0;

    // Fetch the live pool server from Duino-Coin's pool API, fall back to known address
    fetch("https://server.duinocoin.com/getPool")
        .then(r => r.json())
        .then(data => {
            const ip   = data.ip   || "magi.duinocoin.com";
            const port = data.port || 14808;
            connect(`wss://${ip}:${port}`);
        })
        .catch(() => {
            // Fallback if pool API is unreachable
            connect("wss://magi.duinocoin.com:14808");
        });

    function connect(url) {
        var socket = new WebSocket(url);

        socket.onopen = function() {
            console.log(getTime() + " | CPU" + workerVer + ": WebSocket open → " + url);
        };

        socket.onmessage = function(event) {
            var serverMessage = event.data;

            // Server version handshake
            if (serverMessage.startsWith("2.") || serverMessage.startsWith("3.")) {
                console.log(getTime() + " | CPU" + workerVer + ": Connected to node. Server v" + serverMessage.trim());
                postMessage("NodeConnected," + url + "," + workerVer);
                socket.send("JOB," + username + ",LOW" + (miner_key ? "," + miner_key : ""));

            } else if (serverMessage.includes("GOOD")) {
                console.log(getTime() + " | CPU" + workerVer + ": Share accepted: " + result);
                postMessage("GoodShare," + result);
                socket.send("JOB," + username + ",LOW" + (miner_key ? "," + miner_key : ""));

            } else if (serverMessage.includes("BAD")) {
                console.log(getTime() + " | CPU" + workerVer + ": Share rejected: " + result);
                postMessage("BadShare");
                socket.send("JOB," + username + ",LOW" + (miner_key ? "," + miner_key : ""));

            } else if (serverMessage.includes("This user doesn't exist")) {
                postMessage("Error,User not found");

            } else if (serverMessage.includes("Too many workers")) {
                postMessage("Error,Too many workers");

            } else if (serverMessage.length > 40) {
                var job = serverMessage.split(",");
                var difficulty = parseInt(job[2]);
                var target     = job[1];
                var prefix     = job[0];
                var limit      = 100 * difficulty + 1;

                postMessage("UpdateDiff," + difficulty + "," + workerVer);
                console.log(getTime() + " | CPU" + workerVer + ": Job received, diff=" + difficulty);

                // Optimization: create SHA1 instance ONCE per job, not per hash iteration
                var sha1 = new Hashes.SHA1();
                var startingTime = performance.now();
                var found = false;

                for (result = 0; result <= limit; result++) {
                    if (target === sha1.hex(prefix + result)) {
                        var endingTime = performance.now();
                        var timeDifference = (endingTime - startingTime) / 1000;
                        var hashrate = (result / timeDifference).toFixed(2);

                        postMessage(
                            "UpdateLog," +
                            getTime() + " | CPU" + workerVer +
                            ": Nonce " + result +
                            " | " + Math.round(timeDifference) + "s" +
                            " | " + Math.round(hashrate / 1000) + " kH/s<br>"
                        );
                        postMessage("UpdateHashrate," + timeDifference + "," + hashrate + "," + workerVer);
                        socket.send(result + "," + hashrate + ",Optimised Web Miner 2.8," + rigid + ",," + wallet_id);

                        found = true;
                        break; // Optimization: STOP after nonce found
                    }
                }

                if (!found) {
                    // Nonce not in range, request a new job
                    socket.send("JOB," + username + ",LOW" + (miner_key ? "," + miner_key : ""));
                }

            } else {
                console.log(getTime() + " | CPU" + workerVer + ": Unknown msg: " + serverMessage);
            }
        };

        socket.onerror = function(event) {
            console.error("CPU" + workerVer + " WebSocket error:", event);
            socket.close();
        };

        socket.onclose = function(event) {
            console.warn("CPU" + workerVer + " disconnected. Reconnecting in 5s...");
            postMessage("NodeDisconnected," + workerVer);
            setTimeout(function() { connect(url); }, 5000);
        };
    }
};
