importScripts("hashes.js");

function getTime() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

onmessage = function(event) {
    if (!event.data.startsWith("Start")) return;

    const getData   = event.data.split(",");
    const username  = getData[1];
    const rigid     = getData[2] || "None";
    const workerVer = getData[3];
    const wallet_id = getData[4];
    const miner_key = getData[5] || "";

    let result       = 0;
    let everConnected = false;   // only send NodeDisconnected if we were actually connected
    let reconnectDelay = 5000;   // exponential backoff: 5s → 10s → 20s → 30s max

    // Known working WebSocket endpoint for web miners — do NOT fetch getPool,
    // that API returns a TCP address which immediately kills the WS connection.
    connect("wss://magi.duinocoin.com:14808");

    function connect(url) {
        var socket = new WebSocket(url);

        socket.onopen = function() {
            console.log(getTime() + " | CPU" + workerVer + ": Socket opened");
        };

        socket.onmessage = function(event) {
            var msg = event.data;

            if (msg.startsWith("2.") || msg.startsWith("3.")) {
                everConnected = true;
                reconnectDelay = 5000; // reset backoff on successful connect
                postMessage("NodeConnected," + url + "," + workerVer);
                socket.send("JOB," + username + ",LOW" + (miner_key ? "," + miner_key : ""));

            } else if (msg.includes("GOOD")) {
                postMessage("GoodShare," + result);
                socket.send("JOB," + username + ",LOW" + (miner_key ? "," + miner_key : ""));

            } else if (msg.includes("BAD")) {
                postMessage("BadShare");
                socket.send("JOB," + username + ",LOW" + (miner_key ? "," + miner_key : ""));

            } else if (msg.includes("This user doesn't exist")) {
                postMessage("Error,User not found — check your username");

            } else if (msg.includes("Too many workers")) {
                postMessage("Error,Too many workers — reduce thread count");

            } else if (msg.length > 40) {
                var job        = msg.split(",");
                var difficulty = parseInt(job[2]);
                var target     = job[1];
                var prefix     = job[0];
                var limit      = 100 * difficulty + 1;

                postMessage("UpdateDiff," + difficulty + "," + workerVer);

                // OPTIMISATION 1: create SHA1 instance once per job, not per iteration
                var sha1        = new Hashes.SHA1();
                var startTime   = performance.now();
                var found       = false;

                for (result = 0; result <= limit; result++) {
                    if (target === sha1.hex(prefix + result)) {
                        var elapsed  = (performance.now() - startTime) / 1000;
                        var hashrate = (result / elapsed).toFixed(2);

                        postMessage(
                            "UpdateLog," +
                            getTime() + " | CPU" + workerVer +
                            ": Nonce " + result +
                            " | " + Math.round(elapsed) + "s" +
                            " | " + Math.round(hashrate / 1000) + " kH/s<br>"
                        );
                        postMessage("UpdateHashrate," + elapsed + "," + hashrate + "," + workerVer);
                        socket.send(result + "," + hashrate + ",Optimised Web Miner 2.8," + rigid + ",," + wallet_id);

                        found = true;
                        break; // OPTIMISATION 2: stop after nonce found (original kept looping!)
                    }
                }

                if (!found) {
                    socket.send("JOB," + username + ",LOW" + (miner_key ? "," + miner_key : ""));
                }

            } else {
                console.log(getTime() + " | CPU" + workerVer + ": Unknown: " + msg);
            }
        };

        socket.onerror = function() {
            socket.close();
        };

        socket.onclose = function() {
            // Only notify UI if we had a real connection — avoids spam on initial failures
            if (everConnected) {
                postMessage("NodeDisconnected," + workerVer);
                everConnected = false;
            }
            // Exponential backoff: 5s → 10s → 20s → 30s cap
            console.warn("CPU" + workerVer + " closed, retrying in " + reconnectDelay / 1000 + "s");
            setTimeout(function() { connect(url); }, reconnectDelay);
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        };
    }
};
