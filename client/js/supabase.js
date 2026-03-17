import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://macjrktnpxfocvrheups.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hY2pya3RucHhmb2N2cmhldXBzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MzkzNTIsImV4cCI6MjA4OTMxNTM1Mn0.AlSFsiPdmUBXCw2v1H2b4PIdK_r6BfH5qYZKGu-FWTA';

export const supabase = createClient(supabaseUrl, supabaseKey);
