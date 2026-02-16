'use client';

interface RawApiDisplayProps {
  data: any;
}

export default function RawApiDisplay({ data }: RawApiDisplayProps) {
  return (
    <div className="raw-api-display">
      <h3>Raw API Response</h3>
      <pre>
        <code>{JSON.stringify(data, null, 2)}</code>
      </pre>
    </div>
  );
}
