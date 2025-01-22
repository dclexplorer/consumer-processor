#!/bin/bash

# Define pointers as a space-separated list
POINTERS="14,10"

# Convert pointers into JSON array format
POINTERS_JSON=$(printf '"%s",' $POINTERS | sed 's/,$//')
POINTERS_JSON="[$POINTERS_JSON]"

# Make the POST request and store the result
response=$(curl -s -X POST https://peer.decentraland.org/content/entities/active \
-H "Content-Type: application/json" \
-d "{\"pointers\": $POINTERS_JSON}")

# Use jq to extract the array of IDs
ids=$(echo "$response" | jq -r '.[].id')

# Loop through each ID and execute the second request
for id in $ids; do
  echo "Processing ID: $id"
  
  # Execute the second request
  continue
  result=$(curl -s -X POST http://127.0.0.1:8080/add-queue/ \
  -H "Content-Type: application/json" \
  -d "{\"entityId\": \"$id\"}")
  
  # Print the result of the second request
  echo "Result for ID $id: $result"
done
