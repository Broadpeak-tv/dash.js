var METRIC_INTERVAL = 300;

var REMOTE_IP_ADDRESS_REST_API = 'https://explo.broadpeak.tv:8343/remote_addr';
var TRAFFIC_SHAPER_REST_API = 'http://explo.broadpeak.tv:8399/setBandwidth/<ip_adress>/192.168.17.159/443/';

var App = function () {
    this.player = null;
    this.controlbar = null;
    this.video = null;
    this.playing = false;
    this.chartLatency = null;
    this.chartBitrates = null;
    this.domElements = {
        settings: {},
        metrics: {},
        charts: {},
        shaper: {},
        chartLatency: null,
        chartBitrates: null
    };
    this.chartTimeout = null;
    this.chartReportingInterval = 300;
    this.chartNumberOfEntries = 30;
    this.chartLatencyData = {
        currentTime: 0,
        lastTimeStamp: null
    };
    this.chartBitratesData = {
        currentTime: 0,
        lastTimeStamp: null
    };
    this.clientIpAddress = null;
};

App.prototype.init = function () {
    this._setDomElements();
    this._adjustSettingsByUrlParameters();
    this._setupLatencyChart();
    this._setupBitratesChart();
    this._registerEventHandler();
    this._getClientIpAddress();
}

App.prototype._setDomElements = function () {
    this.domElements.settings.targetLatency = document.getElementById('target-latency');
    this.domElements.settings.maxDrift = document.getElementById('max-drift');
    this.domElements.settings.maxCatchupPlaybackRate = document.getElementById('max-catchup-playback-rate');
    this.domElements.settings.minCatchupPlaybackRate = document.getElementById('min-catchup-playback-rate');
    this.domElements.settings.catchupEnabled = document.getElementById('live-catchup-enabled');
    this.domElements.settings.abrAdditionalInsufficientBufferRule = document.getElementById('abr-additional-insufficient')
    this.domElements.settings.abrAdditionalDroppedFramesRule = document.getElementById('abr-additional-dropped');
    this.domElements.settings.abrAdditionalAbandonRequestRule = document.getElementById('abr-additional-abandon');
    this.domElements.settings.abrAdditionalSwitchHistoryRule = document.getElementById('abr-additional-switch');
    this.domElements.settings.targetLatency = document.getElementById('target-latency');
    this.domElements.settings.etpWeightRatio = document.getElementById('etp-weight-ratio');
    this.domElements.settings.applyMb = document.getElementById('apply-mb');
    this.domElements.settings.exportSettingsUrl = document.getElementById('export-settings-url');

    this.domElements.chartLatency = document.getElementById('chart-latency');
    this.domElements.chartBitrates = document.getElementById('chart-bitrates');
    this.domElements.charts.enabled = document.getElementById('charts-enabled');
    this.domElements.charts.interval = document.getElementById('charts-interval');
    this.domElements.charts.numberOfEntries = document.getElementById('charts-number-of-entries');

    this.domElements.metrics.latencyTag = document.getElementById('latency-tag');
    this.domElements.metrics.playbackrateTag = document.getElementById('playbackrate-tag');
    this.domElements.metrics.bufferTag = document.getElementById('buffer-tag');
    this.domElements.metrics.sec = document.getElementById('sec');
    this.domElements.metrics.min = document.getElementById('min');
    this.domElements.metrics.videoMaxIndex = document.getElementById('video-max-index');
    this.domElements.metrics.videoIndex = document.getElementById('video-index');
    this.domElements.metrics.videoBitrate = document.getElementById('video-bitrate');
    this.domElements.metrics.mtp = document.getElementById('mtp');
    this.domElements.metrics.etp = document.getElementById('etp');

    this.domElements.shaper.bandwidth = document.getElementById('traffic-shaper-bw');
}

App.prototype._setupLatencyChart = function () {
    var data = {
        datasets: [
            {
                label: 'Live delay',
                borderColor: '#3944bc',
                backgroundColor: '#3944bc',
            },
            {
                label: 'Buffer level',
                borderColor: '#d0312d',
                backgroundColor: '#d0312d',
            },
            {
                label: 'Playback rate',
                borderColor: '#3cb043',
                backgroundColor: '#3cb043',
            }]
    };
    var config = {
        type: 'line',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0
            },
            elements: {
                point: {
                    radius: 0
                }
            },
            scales: {
                y: {
                    min: 0,
                    ticks: {
                        stepSize: 0.5
                    },
                    title: {
                        display: true,
                        text: 'Value in Seconds'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Value in Seconds'
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                },
                title: {
                    display: true,
                    text: 'Live data',
                    y: {
                        text: 'y-axis'
                    }
                }
            }
        },
    };

    // eslint-disable-next-line no-undef
    this.chartLatency = new Chart(
        this.domElements.chartLatency,
        config
    );
}

App.prototype._setupBitratesChart = function () {
    var data = {
        datasets: [
            {
                label: 'Measured throughput',
                borderColor: '#1818cc',
                backgroundColor: '#1818cc',
            },
            {
                label: 'Estimated throughput (CMSD)',
                borderColor: '#4ca0e0',
                backgroundColor: '#4ca0e0',
            },
            {
                label: 'Downloaded bitrate',
                borderColor: '#f0ae22',
                backgroundColor: '#f0ae22',
            }]
    };
    var config = {
        type: 'line',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0
            },
            elements: {
                point: {
                    radius: 0
                }
            },
            scales: {
                y: {
                    min: 0,
                    ticks: {
                        stepSize: 0.5
                    },
                    title: {
                        display: true,
                        text: 'Value in kbits/s'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Value in kbits/s'
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                },
                title: {
                    display: true,
                    text: 'Live data',
                    y: {
                        text: 'y-axis'
                    }
                }
            }
        },
    };

    // eslint-disable-next-line no-undef
    this.chartBitrates = new Chart(
        this.domElements.chartBitrates,
        config
    );
}

App.prototype._load = function () {
    var url;

    if (this.player) {
        this._stop();
        this.player.reset();
        this.playing = false;
        this._unregisterDashEventHandler();
        this.chartLatencyData.currentTime = 0;
        this.chartLatencyData.lastTimeStamp = null
        this.chartLatency.data.datasets[0].data = [];
        this.chartLatency.data.datasets[1].data = [];
        this.chartLatency.data.datasets[2].data = [];
        this.chartLatency.update();
        this.chartBitratesData.currentTime = 0;
        this.chartBitratesData.lastTimeStamp = null;
        this.chartBitrates.data.datasets[0].data = [];
        this.chartBitrates.data.datasets[1].data = [];
        this.chartBitrates.data.datasets[2].data = [];
        this.chartBitrates.update();
    }

    url = document.getElementById('manifest').value;

    this.video = document.querySelector('video');
    this.player = dashjs.MediaPlayer().create();
    this._registerDashEventHandler();
    this._applyParameters();
    this.player.initialize(this.video, url, true);
    this.controlbar = new ControlBar(this.player);
    this.controlbar.initialize();
    this._startTimers();
}

App.prototype._stop = function () {
    this._stopTimers();
    if (this.player) {
        this.player.attachSource(null);
    }
}

App.prototype._applyParameters = function () {

    if (!this.player) {
        return;
    }

    var settings = this._getCurrentSettings();

    this.player.updateSettings({
        streaming: {
            delay: {
                liveDelay: settings.targetLatency
            },
            liveCatchup: {
                enabled: settings.catchupEnabled,
                maxDrift: settings.maxDrift,
                playbackRate: {
                    min: settings.minCatchupPlaybackRate,
                    max: settings.maxCatchupPlaybackRate
                },
                mode: settings.catchupMechanism
            },
            abr: {
                ABRStrategy: settings.abrGeneral,
                additionalAbrRules: {
                    insufficientBufferRule: settings.abrAdditionalInsufficientBufferRule,
                    switchHistoryRule: settings.abrAdditionalSwitchHistoryRule,
                    droppedFramesRule: settings.abrAdditionalDroppedFramesRule,
                    abandonRequestsRule: settings.abrAdditionalAbandonRequestRule
                },
                fetchThroughputCalculationMode: settings.throughputCalculation
            },
            cmsd: {
                enabled: true,
                abr: {
                    applyMb: settings.applyMb,
                    etpWeightRatio: settings.etpWeightRatio
                }
            }
        }
    });
}

App.prototype._exportSettings = function () {
    var settings = this._getCurrentSettings();
    var url = document.location.origin + document.location.pathname;

    url += '?';

    for (var [key, value] of Object.entries(settings)) {
        url += '&' + key + '=' + value
    }

    url = encodeURI(url);
    const element = document.createElement('textarea');
    element.value = url;
    document.body.appendChild(element);
    element.select();
    document.execCommand('copy');
    document.body.removeChild(element);

    Swal.fire({
        position: 'top-end',
        icon: 'success',
        title: 'Settings URL copied to clipboard',
        showConfirmButton: false,
        timer: 1500
    })
}


App.prototype._getCurrentSettings = function () {
    var targetLatency = parseFloat(this.domElements.settings.targetLatency.value, 10);
    var maxDrift = parseFloat(this.domElements.settings.maxDrift.value, 10);
    var minCatchupPlaybackRate = parseFloat(this.domElements.settings.minCatchupPlaybackRate.value, 10);
    var maxCatchupPlaybackRate = parseFloat(this.domElements.settings.maxCatchupPlaybackRate.value, 10);
    var abrAdditionalInsufficientBufferRule = this.domElements.settings.abrAdditionalInsufficientBufferRule.checked;
    var abrAdditionalDroppedFramesRule = this.domElements.settings.abrAdditionalDroppedFramesRule.checked;
    var abrAdditionalAbandonRequestRule = this.domElements.settings.abrAdditionalAbandonRequestRule.checked;
    var abrAdditionalSwitchHistoryRule = this.domElements.settings.abrAdditionalSwitchHistoryRule.checked;
    var catchupEnabled = this.domElements.settings.catchupEnabled.checked;
    var abrGeneral = document.querySelector('input[name="abr-general"]:checked').value;
    var catchupMechanism = document.querySelector('input[name="catchup"]:checked').value;
    var throughputCalculation = document.querySelector('input[name="throughput-calc"]:checked').value;
    var etpWeightRatio = parseFloat(this.domElements.settings.etpWeightRatio.value, 10);
    var applyMb = this.domElements.settings.applyMb.checked;

    return {
        targetLatency,
        maxDrift,
        minCatchupPlaybackRate,
        maxCatchupPlaybackRate,
        abrGeneral,
        abrAdditionalInsufficientBufferRule,
        abrAdditionalDroppedFramesRule,
        abrAdditionalAbandonRequestRule,
        abrAdditionalSwitchHistoryRule,
        catchupMechanism,
        catchupEnabled,
        throughputCalculation,
        etpWeightRatio,
        applyMb
    }
}

App.prototype._adjustSettingsByUrlParameters = function () {
    var urlSearchParams = new URLSearchParams(window.location.search);
    var params = Object.fromEntries(urlSearchParams.entries());

    if (params) {
        if (params.targetLatency !== undefined) {
            this.domElements.settings.targetLatency.value = parseFloat(params.targetLatency).toFixed(1);
        }
        if (params.maxDrift !== undefined) {
            this.domElements.settings.maxDrift.value = parseFloat(params.maxDrift).toFixed(1);
        }
        if (params.minCatchupPlaybackRate !== undefined) {
            this.domElements.settings.minCatchupPlaybackRate.value = parseFloat(params.minCatchupPlaybackRate).toFixed(2);
        }
        if (params.maxCatchupPlaybackRate !== undefined) {
            this.domElements.settings.maxCatchupPlaybackRate.value = parseFloat(params.maxCatchupPlaybackRate).toFixed(2);
        }
        if (params.abrAdditionalInsufficientBufferRule !== undefined) {
            this.domElements.settings.abrAdditionalInsufficientBufferRule.checked = params.abrAdditionalInsufficientBufferRule === 'true';
        }
        if (params.abrAdditionalAbandonRequestRule !== undefined) {
            this.domElements.settings.abrAdditionalAbandonRequestRule.checked = params.abrAdditionalAbandonRequestRule === 'true';
        }
        if (params.abrAdditionalSwitchHistoryRule !== undefined) {
            this.domElements.settings.abrAdditionalSwitchHistoryRule.checked = params.abrAdditionalSwitchHistoryRule === 'true';
        }
        if (params.abrAdditionalDroppedFramesRule !== undefined) {
            this.domElements.settings.abrAdditionalDroppedFramesRule.checked = params.abrAdditionalDroppedFramesRule === 'true';
        }
        if (params.catchupEnabled !== undefined) {
            this.domElements.settings.catchupEnabled.checked = params.catchupEnabled === 'true';
        }
        if (params.abrGeneral !== undefined) {
            document.getElementById(params.abrGeneral).checked = true;
        }
        if (params.catchupMechanism !== undefined) {
            document.getElementById(params.catchupMechanism).checked = true;
        }
        if (params.throughputCalculation !== undefined) {
            document.getElementById(params.throughputCalculation).checked = true;
        }
        if (params.etpWeightRatio !== undefined) {
            this.domElements.settings.etpWeightRatio.value = parseFloat(params.etpWeightRatio);
        }
        if (params.applyMb !== undefined) {
            this.domElements.settings.applyMb.checked = params.applyMb === 'true';
        }
    }
}

App.prototype._adjustChartSettings = function () {

    if (!isNaN(parseInt(this.domElements.charts.interval.value))) {
        this.chartReportingInterval = parseInt(this.domElements.charts.interval.value);
    }

    if (!isNaN(parseInt(this.domElements.charts.numberOfEntries.value))) {
        this.chartNumberOfEntries = parseInt(this.domElements.charts.numberOfEntries.value);
    }

    this._enableChart(this.domElements.charts.enabled.checked);
}

App.prototype._startTimers = function () {
    this.metricsInterval = setInterval(() => {
        this._updateMetrics();
    }, METRIC_INTERVAL);
    this._enableChart(this.domElements.charts.enabled.checked);
}

App.prototype._stopTimers = function () {

    if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
        this.metricsInterval = null;
    }
    if (this.chartInterval) {
        clearInterval(this.chartInterval);
        this.chartInterval = null;
    }
}

App.prototype._enableChart = function (enabled) {
    if (this.chartInterval) {
        clearInterval(this.chartInterval);
        this.chartInterval = null;
    }
    if (enabled) {
        this.chartInterval = setInterval(() => {
            this._updateChartLatency();
            this._updateChartBitrates();
        }, this.chartReportingInterval);    
    }
}

App.prototype._updateMetrics = function () {
    if (!this.player || !this.player.isReady()) {
        return;
    }
    var dashMetrics = this.player.getDashMetrics();

    var currentLatency = parseFloat(this.player.getCurrentLiveLatency(), 10);
    this.domElements.metrics.latencyTag.innerHTML = currentLatency + ' secs';

    var currentPlaybackRate = this.player.getPlaybackRate();
    this.domElements.metrics.playbackrateTag.innerHTML = Math.round(currentPlaybackRate * 1000) / 1000;

    var currentBuffer = dashMetrics.getCurrentBufferLevel('video');
    this.domElements.metrics.bufferTag.innerHTML = currentBuffer + ' secs';

    const mtp = this.player.getAverageThroughput('video');
    const etp = this._getLastVideoRequestThroughput().etp;
    this.domElements.metrics.mtp.innerHTML = (mtp / 1000).toFixed(3);
    this.domElements.metrics.etp.innerHTML = (etp / 1000).toFixed(3);

    var d = new Date();
    var seconds = d.getSeconds();
    this.domElements.metrics.sec.innerHTML = (seconds < 10 ? '0' : '') + seconds;
    var minutes = d.getMinutes();
    this.domElements.metrics.min.innerHTML = (minutes < 10 ? '0' : '') + minutes + ':';
}

App.prototype._updateChartLatency = function () {
    if (!this.player || !this.player.isReady()) {
        return;
    }
    const data = this.chartLatency.data;
    if (data.datasets.length <= 0) {
        return;
    }

    if (data.labels.length > this.chartNumberOfEntries) {
        data.labels.shift();
    }

    if (this.chartLatencyData.lastTimeStamp) {
        this.chartLatencyData.currentTime += Date.now() - this.chartLatencyData.lastTimeStamp;
    }

    data.labels.push(parseFloat(this.chartLatencyData.currentTime / 1000).toFixed(3));

    this.chartLatencyData.lastTimeStamp = Date.now();

    for (var i = 0; i < data.datasets.length; i++) {
        if (data.datasets[i].data.length > this.chartNumberOfEntries) {
            data.datasets[i].data.shift();
        }
    }
    data.datasets[0].data.push(parseFloat(this.player.getCurrentLiveLatency()).toFixed(2));

    var dashMetrics = this.player.getDashMetrics();
    data.datasets[1].data.push(parseFloat(dashMetrics.getCurrentBufferLevel('video')).toFixed(2));

    data.datasets[2].data.push(parseFloat(this.playing ? this.player.getPlaybackRate() : 0).toFixed(2));

    this.chartLatency.update();
}

App.prototype._updateChartBitrates = function () {
    if (!this.player || !this.player.isReady()) {
        return;
    }
    const data = this.chartBitrates.data;
    if (data.datasets.length <= 0) {
        return;
    }

    if (data.labels.length > this.chartNumberOfEntries) {
        data.labels.shift();
    }

    if (this.chartBitratesData.lastTimeStamp) {
        this.chartBitratesData.currentTime += Date.now() - this.chartBitratesData.lastTimeStamp;
    }

    data.labels.push(parseFloat(this.chartBitratesData.currentTime / 1000).toFixed(3));

    this.chartBitratesData.lastTimeStamp = Date.now();

    for (var i = 0; i < data.datasets.length; i++) {
        if (data.datasets[i].data.length > this.chartNumberOfEntries) {
            data.datasets[i].data.shift();
        }
    }

    const mtp = this.player.getAverageThroughput('video');
    const metrics =  this._getLastVideoRequestThroughput();
    data.datasets[0].data.push(mtp / 1000);
    data.datasets[1].data.push(metrics.etp / 1000);
    data.datasets[2].data.push(parseFloat(this.domElements.metrics.videoBitrate.innerHTML) / 1000);

    this.chartBitrates.update();
}

App.prototype._registerEventHandler = function () {
    document.getElementById('apply-settings-button').addEventListener('click', () => {
        this._applyParameters();
        Swal.fire({
            position: 'top-end',
            icon: 'success',
            title: 'Settings applied',
            showConfirmButton: false,
            timer: 1500
        })
    })

    document.getElementById('load-button').addEventListener('click', () => {
        this._load();
    });

    document.getElementById('stop-button').addEventListener('click', () => {
        this._stop();
    });

    document.getElementById('export-settings-button').addEventListener('click', () => {
        this._exportSettings();
    });

    document.getElementById('charts-settings-button').addEventListener('click', () => {
        this._adjustChartSettings();
        Swal.fire({
            position: 'top-end',
            icon: 'success',
            title: 'Settings applied',
            showConfirmButton: false,
            timer: 1500
        })
    })

    document.getElementById('traffic-shaper-button').addEventListener('click', () => {
        this._setTrafficShaperBandwidth();
    })
}

App.prototype._registerDashEventHandler = function () {
    this.player.on(dashjs.MediaPlayer.events.REPRESENTATION_SWITCH, this._onRepresentationSwitch, this);
    this.player.on(dashjs.MediaPlayer.events.PLAYBACK_WAITING, this._onPlaybackWaiting, this);
    this.player.on(dashjs.MediaPlayer.events.PLAYBACK_PLAYING, this._onPlaybackPlaying, this);
}

App.prototype._unregisterDashEventHandler = function () {
    this.player.off(dashjs.MediaPlayer.events.REPRESENTATION_SWITCH, this._onRepresentationSwitch, this);
    this.player.off(dashjs.MediaPlayer.events.PLAYBACK_WAITING, this._onPlaybackWaiting, this);
    this.player.off(dashjs.MediaPlayer.events.PLAYBACK_PLAYING, this._onPlaybackPlaying, this);
}

App.prototype._onRepresentationSwitch = function (e) {
    try {
        if (e.mediaType === 'video') {
            this.domElements.metrics.videoMaxIndex.innerHTML = e.numberOfRepresentations
            this.domElements.metrics.videoIndex.innerHTML = e.currentRepresentation.index + 1;
            var bitrate = Math.round(e.currentRepresentation.bandwidth / 1000);
            this.domElements.metrics.videoBitrate.innerHTML = bitrate;
        }
    } catch (e) {

    }
}

App.prototype._getLastVideoRequestThroughput = function (e) {
    try {
        var dashMetrics = this.player.getDashMetrics();
        var requests = dashMetrics.getHttpRequests('video');

        requests = requests.slice(-20).filter(function (req) {
            return req.responsecode >= 200 && req.responsecode < 300 && /*req.type === 'MediaSegment' &&*/ req._stream === 'video' && !!req._mediaduration;
        }).slice(-4);

        if (requests.length === 0) {
            return 0;
        }

        // Get last request
        const request = requests[requests.length - 1];

        // Measure throughput
        const downloadBytes = request.trace.reduce((a, b) => a + b.b[0], 0);
        const throughputMeasureTime = (request._fileLoaderType && request._fileLoaderType === 'fetch_loader'/*Constants.FILE_LOADER_TYPES.FETCH*/) ?
            request.trace.reduce((a, b) => a + b.d, 0) :
            (request._tfinish.getTime() - request.tresponse.getTime()) || 1;
    
        const mtp = (throughputMeasureTime !== 0) ? Math.round((8 * downloadBytes) / throughputMeasureTime) : 0; // bits/ms = kbits/s

        // Get CMSD estimated throughput
        const etp = request.cmsd && request.cmsd.dynamic && request.cmsd.dynamic.etp ? request.cmsd.dynamic.etp : 0;

        return { mtp, etp };
    } catch (e) {
        return 0;
    }
}

App.prototype._onPlaybackWaiting = function (e) {
    this.playing = false;
    this._updateChartLatency();
}

App.prototype._onPlaybackPlaying = function (e) {
    this.playing = true;
    this._updateChartLatency();
}

App.prototype._getClientIpAddress = function (e) {
    fetch(REMOTE_IP_ADDRESS_REST_API)
    .then((response) => response.text())
    .then((data) => {
        this.clientIpAddress = data;
        console.log('Client IP address:', this.clientIpAddress);
    });
}

App.prototype._showActionStatus = function (success, message) {
    Swal.fire({
        position: 'top-end',
        icon: success ? 'success' : 'error',
        title: message,
        showConfirmButton: false,
        timer: 1500
    })
}

App.prototype._setTrafficShaperBandwidth = function (e) {
    if (!this.clientIpAddress) {
        return;
    }
    const bw = this.domElements.shaper.bandwidth.value;
    const rest_api_url = TRAFFIC_SHAPER_REST_API.replace('<ip_adress>', this.clientIpAddress) + bw;
    fetch(rest_api_url)
    .then((response) => response.text())
    .then((data) => {
        const success = data.includes('applied bw');
        this._showActionStatus(success, success ? 'Bandwidth applied' : 'Failed to apply bandwidth');
    })
    .catch((error) => {
        this._showActionStatus(false, 'Failed to request traffic shaper REST API');
    });
}