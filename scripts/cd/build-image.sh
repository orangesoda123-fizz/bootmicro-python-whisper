set -u # or set -o nounset
: "$CONTAINER_REGISTRY"
: "$VERSION"
: "$NAME"
: "$DIRECTORY"

docker build -t $CONTAINER_REGISTRY/$NAME:$VERSION --file ./$DIRECTORY/Dockerfile-prod ./$DIRECTORY
