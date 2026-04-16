set -u # or set -o nounset
: "$CONTAINER_REGISTRY"
: "$NAME"
: "$VERSION"

envsubst < ./scripts/cd/${NAME}.yaml | kubectl apply -f -
