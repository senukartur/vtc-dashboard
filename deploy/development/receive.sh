#!/bin/sh
# Root owns both files. sudo receives no caller-controlled arguments.
exec /usr/bin/sudo -n /usr/bin/python3 /opt/vtc-development/operations.py receive
