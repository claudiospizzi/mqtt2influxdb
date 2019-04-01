#!/usr/bin/env node

const log = require('yalm');
const mqtt = require('mqtt');

const pkg = require('./package.json');
const cfg = require(process.argv[2] || './config.json');
