// VTC-021 owns durable leases and handlers. A scaffold must not claim work was processed.
console.log(JSON.stringify({ status: "not_configured", ownerCard: "VTC-021", processed: 0 }));
