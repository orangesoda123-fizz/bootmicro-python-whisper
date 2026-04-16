set -u # or set -o nounset
: "$NAME"

envsubst < ./scripts/cd/${NAME}.yaml | kubectl delete -f -
