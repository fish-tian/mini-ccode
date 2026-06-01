import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import CreatePage from "./pages/CreatePage";
import PollPage from "./pages/PollPage";
import ResultsPage from "./pages/ResultsPage";
import SharePage from "./pages/SharePage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/create" element={<CreatePage />} />
        <Route path="/poll/:id" element={<PollPage />} />
        <Route path="/results/:id" element={<ResultsPage />} />
        <Route path="/share/:id" element={<SharePage />} />
      </Route>
    </Routes>
  );
}
