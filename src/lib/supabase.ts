import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nfdlvwjbbqohxbtpnsom.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mZGx2d2piYnFvaHhidHBuc29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTAxNjcsImV4cCI6MjA4NTc4NjE2N30.oQ6Q_jgs7Kh9aNbeYLLY0Wrzl5xDRjlJUBZDEBx7sTM';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default supabase;