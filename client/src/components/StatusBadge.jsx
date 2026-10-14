import React from 'react';
import { Clock, Loader, AlertTriangle, CheckCircle } from 'lucide-react';

export default function StatusBadge({ status }) {
  switch (status) {
    case 'Uploaded':
      return (
        <span className="badge badge-uploaded">
          <Clock size={12} /> Uploaded
        </span>
      );
    case 'Processing':
      return (
        <span className="badge badge-processing">
          <Loader size={12} className="spin" /> Processing
        </span>
      );
    case 'Needs review':
      return (
        <span className="badge badge-needs-review">
          <AlertTriangle size={12} /> Needs Review
        </span>
      );
    case 'Verified':
      return (
        <span className="badge badge-verified">
          <CheckCircle size={12} /> Verified
        </span>
      );
    default:
      return <span className="badge">{status}</span>;
  }
}
