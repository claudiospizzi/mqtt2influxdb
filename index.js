#!/usr/bin/env node

const log = require('yalm');
const mqtt = require('mqtt');
const influx = require('influx');

const pkg = require('./package.json');
const cfg = require(process.argv[2] || './config.json');

let mqttConnected;

log.setLevel(cfg.log);
log.info(pkg.name + ' ' + pkg.version + ' starting');

const mqttClient = mqtt.connect(
    cfg.mqtt.url, {
        will: { topic: cfg.mqtt.name + '/connected', payload: '0', retain: true },
        rejectUnauthorized: cfg.mqtt.secure
    }
);

const influxClient = new influx.InfluxDB({
    host: cfg.influxdb.host,
    port: cfg.influxdb.port,
    database: cfg.influxdb.database
});

mqttClient.on('connect', () => {

    mqttClient.publish(cfg.mqtt.name + '/connected', '2', { retain: true });

    mqttConnected = true;
    log.info('mqtt: connected ' + cfg.mqtt.url);

    cfg.influxdb.connectors.forEach(connector => {
        mqttClient.subscribe(connector.topic);
        log.info('mqtt: subscribe ' + connector.topic);
    });
});

mqttClient.on('close', () => {

    if (mqttConnected) {
        mqttConnected = false;
        log.info('mqtt: disconnected ' + cfg.mqtt.url);
    }
});

mqttClient.on('error', err => {

    log.error('mqtt: error ' + err.message);
});

mqttClient.on('message', (topic, payload, msg) => {

    cfg.influxdb.connectors.forEach(connector => {

        var match = topic.match(connector.match);

        if (match != null) {

            var point = {
                measurement: null,
                tags: {},
                fields: {},
                timestamp: null
            };

            // Parse the JSON payload to get val and ts properties
            payload = JSON.parse(payload.toString());

            // Try to extract the measurement, first from the topic or else from
            // the connector interface definition.
            if (match.groups.measurement != null) {
                point.measurement = match.groups.measurement;
            }
            else if (connector.measurement != null) {
                point.measurement = connector.measurement;
            }

            // Add all tags from the topic and the connector interface to the
            // point.
            for (key in match.groups) {
                if (key.startsWith('tag_')) {
                    point.tags[key.substring(4)] = match.groups[key];
                }
            }
            for (key in connector.tags) {
                point.tags[key] = connector.tags[key];
            }

            // Add the val from the mqtt message to the point as field.
            if (connector.fieldName != null && payload.val != null) {
                point.fields[connector.fieldName] = payload.val;
            }

            // Set the timestamp from the mqtt payload or generate a new
            // timestamp with the current time.
            if (payload.ts != null) {
                point.timestamp = payload.ts * 1000 * 1000;
            }
            else {
                point.timestamp = Date.now() * 1000 * 1000;
            }

            influxClient.writePoints([
                point
            ])
            .then(() => {
                log._debug('influxdb: write data ' + JSON.stringify(point));
            })
            .catch((error) => {
                log.error(error);
            });
        }
    });
});
