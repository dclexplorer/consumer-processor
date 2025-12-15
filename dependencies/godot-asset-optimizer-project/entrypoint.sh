#!/bin/bash

# turn on bash's job control
set -m

/usr/bin/Xvfb -ac :99 -screen 0 1280x1024x24 > /dev/null 2>&1 &
export DISPLAY=:99
/usr/bin/node --enable-source-maps --trace-warnings --abort-on-uncaught-exception --unhandled-rejections=strict dist/index.js "$@"

fg %1
